mod storage;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::{sync::Arc, time::{SystemTime, UNIX_EPOCH}};
use storage::{Notification, Subscription};
use tower_http::services::ServeDir;
use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushError, WebPushMessageBuilder,
};

struct Config {
    public_key: String,
    private_key: String,
    subject: String,
    token: String,
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("falta la variable {name} en .env"))
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let cfg = Arc::new(Config {
        public_key: env("VAPID_PUBLIC_KEY"),
        private_key: env("VAPID_PRIVATE_KEY"),
        subject: env("VAPID_SUBJECT"),
        token: env("NOTIFY_TOKEN"),
    });
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());

    let app = Router::new()
        .route("/api/vapid-public-key", get(public_key))
        .route("/api/subscribe", post(subscribe))
        .route("/api/notifications", get(notifications))
        .route("/api/notify", post(notify))
        .route("/api/test", post(test_push))
        .fallback_service(ServeDir::new("public"))
        .with_state(cfg);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.unwrap();
    println!("Escuchando en http://0.0.0.0:{port}");
    axum::serve(listener, app).await.unwrap();
}

async fn public_key(State(cfg): State<Arc<Config>>) -> String {
    cfg.public_key.clone()
}

async fn subscribe(Json(sub): Json<Subscription>) -> StatusCode {
    storage::add_subscription(sub);
    StatusCode::CREATED
}

async fn notifications() -> Json<Vec<Notification>> {
    Json(storage::list_notifications())
}

#[derive(Deserialize)]
struct NotifyReq {
    title: String,
    body: String,
}

async fn notify(
    State(cfg): State<Arc<Config>>,
    headers: HeaderMap,
    Json(req): Json<NotifyReq>,
) -> StatusCode {
    let expected = format!("Bearer {}", cfg.token);
    let ok = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map_or(false, |v| v == expected);
    if !ok {
        return StatusCode::UNAUTHORIZED;
    }

    dispatch_push(&cfg, req.title, req.body).await;
    StatusCode::OK
}

async fn test_push(State(cfg): State<Arc<Config>>) -> StatusCode {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        dispatch_push(&cfg, "Prueba".into(), "Notificación de prueba".into()).await;
    });
    StatusCode::ACCEPTED
}

async fn dispatch_push(cfg: &Config, title: String, body: String) {
    let time = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    storage::add_notification(Notification { title: title.clone(), body: body.clone(), time });

    let payload = serde_json::json!({ "title": title, "body": body }).to_string();
    let client = IsahcWebPushClient::new().unwrap();
    for sub in storage::list_subscriptions() {
        match send(&client, cfg, &sub, payload.as_bytes()).await {
            Ok(()) => {}
            Err(WebPushError::EndpointNotValid) | Err(WebPushError::EndpointNotFound) => {
                storage::remove_subscription(&sub.endpoint);
            }
            Err(e) => eprintln!("error enviando push: {e}"),
        }
    }
}

async fn send(
    client: &IsahcWebPushClient,
    cfg: &Config,
    sub: &Subscription,
    payload: &[u8],
) -> Result<(), WebPushError> {
    let info = SubscriptionInfo::new(&sub.endpoint, &sub.keys.p256dh, &sub.keys.auth);
    let mut sig = VapidSignatureBuilder::from_base64(&cfg.private_key, web_push::URL_SAFE_NO_PAD, &info)?;
    sig.add_claim("sub", cfg.subject.as_str());
    let mut msg = WebPushMessageBuilder::new(&info);
    msg.set_payload(ContentEncoding::Aes128Gcm, payload);
    msg.set_vapid_signature(sig.build()?);
    client.send(msg.build()?).await
}

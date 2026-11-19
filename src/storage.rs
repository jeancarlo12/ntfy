//! Acceso a datos aislado. Hoy: data.json. Para cambiar a Redis, reimplementa estas funciones.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const FILE: &str = "data.json";
const MAX_NOTIFICATIONS: usize = 100;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: Keys,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Keys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Notification {
    pub title: String,
    pub body: String,
    /// Segundos Unix
    pub time: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Data {
    subscriptions: Vec<Subscription>,
    /// Más reciente primero
    notifications: Vec<Notification>,
}

fn load() -> Data {
    std::fs::read_to_string(FILE)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(d: &Data) {
    if let Err(e) = std::fs::write(FILE, serde_json::to_string_pretty(d).unwrap()) {
        eprintln!("no se pudo escribir {FILE}: {e}");
    }
}

pub fn add_subscription(s: Subscription) {
    let _g = LOCK.lock().unwrap();
    let mut d = load();
    if !d.subscriptions.iter().any(|x| x.endpoint == s.endpoint) {
        d.subscriptions.push(s);
        save(&d);
    }
}

pub fn remove_subscription(endpoint: &str) {
    let _g = LOCK.lock().unwrap();
    let mut d = load();
    d.subscriptions.retain(|x| x.endpoint != endpoint);
    save(&d);
}

pub fn list_subscriptions() -> Vec<Subscription> {
    let _g = LOCK.lock().unwrap();
    load().subscriptions
}

pub fn add_notification(n: Notification) {
    let _g = LOCK.lock().unwrap();
    let mut d = load();
    d.notifications.insert(0, n);
    d.notifications.truncate(MAX_NOTIFICATIONS);
    save(&d);
}

pub fn list_notifications() -> Vec<Notification> {
    let _g = LOCK.lock().unwrap();
    load().notifications
}

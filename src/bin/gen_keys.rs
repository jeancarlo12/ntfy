use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use p256::{elliptic_curve::sec1::ToEncodedPoint, SecretKey};
use rand_core::OsRng;

fn main() {
    let secret = SecretKey::random(&mut OsRng);
    let public = secret.public_key().to_encoded_point(false);
    println!("VAPID_PUBLIC_KEY={}", B64.encode(public.as_bytes()));
    println!("VAPID_PRIVATE_KEY={}", B64.encode(secret.to_bytes()));
    println!("VAPID_SUBJECT=mailto:tu@email.com");
}

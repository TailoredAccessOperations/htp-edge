use axum::{extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, services::ServeDir};

const PRICE_URL: &str = "https://mempool.space/api/v1/prices";
const HEIGHT_URL: &str = "https://mempool.space/api/blocks/tip/height";
const MEMPOOL_URL: &str = "https://mempool.space/api/mempool";
const RECENT_URL: &str = "https://mempool.space/api/mempool/recent";

const CACHE_TTL: Duration = Duration::from_secs(30);
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MempoolStats {
    tx_count: u64,
    tx_count_24h: u64,
    funding_txs: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Transaction {
    id: String,
    fee: String,
    size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BTCGlobalStats {
    price_usd: f64,
    block_height: u64,
    hash_rate: String,
    mempool_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MempoolResponse {
    stats: MempoolStats,
    txs: Vec<Transaction>,
    globals: BTCGlobalStats,
}

#[derive(Debug, Deserialize)]
struct ApiMempool {
    count: u64,
}

#[derive(Debug, Deserialize)]
struct ApiRecentTx {
    txid: String,
    fee: u64,
    vsize: u64,
}

#[derive(Debug, Deserialize)]
struct ApiPrice {
    #[serde(rename = "USD")]
    usd: f64,
}

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    cache: Arc<RwLock<Option<(Instant, MempoolResponse)>>>,
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, url: &str) -> Option<T> {
    match client.get(url).send().await {
        Ok(res) => res.json::<T>().await.ok(),
        Err(_) => None,
    }
}

async fn get_btc_price(client: &reqwest::Client) -> f64 {
    fetch_json::<ApiPrice>(client, PRICE_URL).await.map(|p| p.usd).unwrap_or(0.0)
}

async fn get_block_height(client: &reqwest::Client) -> u64 {
    match client.get(HEIGHT_URL).send().await {
        Ok(res) => res.text().await.ok().and_then(|t| t.trim().parse::<u64>().ok()).unwrap_or(0),
        Err(_) => 0,
    }
}

async fn get_mempool_txs(client: &reqwest::Client) -> (Vec<Transaction>, u64) {
    let stats = fetch_json::<ApiMempool>(client, MEMPOOL_URL).await;
    let count = stats.map(|s| s.count).unwrap_or(0);

    let txs = match fetch_json::<Vec<ApiRecentTx>>(client, RECENT_URL).await {
        Some(recent) => recent
            .into_iter()
            .take(10)
            .map(|tx| {
                let rate = tx.fee / tx.vsize.max(1);
                Transaction {
                    id: tx.txid,
                    fee: format!("{} sat/vB", rate),
                    size: tx.vsize,
                }
            })
            .collect(),
        None => Vec::new(),
    };
    (txs, count)
}

async fn build_response(state: &AppState) -> MempoolResponse {
    let (price, height, (txs, count)) = tokio::join!(
        get_btc_price(&state.client),
        get_block_height(&state.client),
        get_mempool_txs(&state.client),
    );

    MempoolResponse {
        stats: MempoolStats {
            tx_count: count,
            tx_count_24h: count,
            funding_txs: 0,
        },
        txs,
        globals: BTCGlobalStats {
            price_usd: price,
            block_height: height,
            hash_rate: "—".to_string(),
            mempool_size: count,
        },
    }
}

async fn get_mempool_data(State(state): State<AppState>) -> Json<MempoolResponse> {
    if let Some((at, cached)) = &*state.cache.read().await {
        if at.elapsed() < CACHE_TTL {
            return Json(cached.clone());
        }
    }

    let response = build_response(&state).await;
    *state.cache.write().await = Some((Instant::now(), response.clone()));
    Json(response)
}

#[tokio::main]
async fn main() {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent("pixelman/btc-mempool")
        .build()
        .expect("failed to build HTTP client");

    let state = AppState {
        client,
        cache: Arc::new(RwLock::new(None)),
    };

    let app = Router::new()
        .route("/api/mempool", get(get_mempool_data))
        .with_state(state)
        .fallback_service(ServeDir::new("static"))
        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT").unwrap_or_else(|_| "8085".to_string()).parse::<u16>().unwrap_or(8085);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Bitcoin Mempool Server running on http://{}", addr);

    axum::Server::bind(&addr)
        .tcp_nodelay(true)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
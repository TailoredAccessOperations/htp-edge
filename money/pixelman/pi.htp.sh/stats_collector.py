import os
import psutil
import time
import json
import socket
from datetime import datetime

def get_stats():
    cpu_pct = psutil.cpu_percent(interval=0.1)
    load = os.getloadavg() if hasattr(os, 'getloadavg') else [0.0, 0.0, 0.0]
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disk = psutil.disk_usage('/')
    net_io = psutil.net_io_counters()
    boot_time = psutil.boot_time()
    uptime_s = int(time.time() - boot_time)
    
    return {
        "uptime_s": uptime_s,
        "boot_ts": int(boot_time),
        "cpu": {"pct": cpu_pct, "cores": psutil.cpu_count(), "temp_c": 0, "load": load},
        "mem": {"used_mb": mem.used // (1024**2), "total_mb": mem.total // (1024**2), "avail_mb": mem.available // (1024**2), "pct": mem.percent, "swap_used_mb": swap.used // (1024**2), "swap_total_mb": swap.total // (1024**2)},
        "disk": {"used_pct": disk.percent, "total_gb": disk.total // (1024**3), "free_gb": disk.free // (1024**3)},
        "net": {"iface": "main", "rx_kbps": 0, "tx_kbps": 0, "rx_total_mb": net_io.bytes_recv // (1024**2), "tx_total_mb": net_io.bytes_sent // (1024**2)},
        "wifi": {"quality_pct": 100},
        "throttled": {"now": False, "ever": False},
        "services": [],
        "history": {"cpu": [cpu_pct]*10, "rx": [0]*10, "tx": [0]*10},
        "ts": int(time.time())
    }

if __name__ == "__main__":
    while True:
        try:
            with open("/var/www/html/stats.json", "w") as f:
                json.dump(get_stats(), f)
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(2)

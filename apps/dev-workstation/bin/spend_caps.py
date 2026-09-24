#!/usr/bin/env python3
"""Reconcile the gateway's spend caps with the configured ones (one-shot, idempotent).

Waits for the gateway's /readyz, then for each desired cap POSTs {scope, amount, period} to
/v1/organizations/spend_limits (create or replace), and deletes caps for a (scope, period) that
is no longer configured. Amounts are whole-number strings of USD cents.

Environment: GATEWAY_URL, ADMIN_KEY_FILE, CA_FILE, SPEND_CAPS (JSON list rendered by render.py).
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ["GATEWAY_URL"].rstrip("/")
CTX = ssl.create_default_context(cafile=os.environ.get("CA_FILE", "/etc/agent-host/ca.pem"))
with open(os.environ.get("ADMIN_KEY_FILE", "/run/secrets/gateway_admin_write_key"), encoding="utf-8") as fh:
    KEY = fh.read().strip()
DESIRED = json.loads(os.environ.get("SPEND_CAPS", "[]"))


def log(msg):
    print(f"spend-caps: {msg}", file=sys.stderr, flush=True)


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "x-api-key": KEY, "content-type": "application/json", "accept": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def scope_key(scope):
    t = scope.get("type")
    ident = scope.get("user_id") or scope.get("rbac_group_id") or ""
    return (t, ident)


def wait_ready(limit_s=900):
    deadline = time.time() + limit_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE + "/readyz", context=CTX, timeout=10) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(5)
    sys.exit("spend-caps: gateway never became ready")


def existing():
    caps, after = [], None
    while True:
        q = "/v1/organizations/spend_limits?limit=1000" + (f"&after_id={after}" if after else "")
        page = call("GET", q)
        caps.extend(page.get("data", []))
        if not page.get("has_more") or not page.get("data"):
            return caps
        after = page.get("last_id") or page["data"][-1]["id"]


def main():
    wait_ready()
    want = {(scope_key(c["scope"]), c["period"]): c for c in DESIRED}
    for cap in DESIRED:
        for attempt in range(5):
            try:
                res = call("POST", "/v1/organizations/spend_limits", cap)
                log(f"set {cap['scope']} {cap['period']} = {cap['amount']} cents ({res.get('id', '?')})")
                break
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:300]
                if exc.code < 500 or attempt == 4:
                    sys.exit(f"spend-caps: POST {cap} failed: {exc.code} {detail}")
                time.sleep(5 * (attempt + 1))
    for cap in existing():
        key = (scope_key(cap.get("scope", {})), cap.get("period"))
        if key not in want and cap.get("id"):
            call("DELETE", f"/v1/organizations/spend_limits/{cap['id']}")
            log(f"deleted stale cap {cap['id']} {key}")
    log(f"{len(DESIRED)} caps in place")


if __name__ == "__main__":
    main()

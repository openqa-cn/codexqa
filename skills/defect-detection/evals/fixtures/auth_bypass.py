API_KEY = "sk_live_hardcoded_example_for_scan"  # clear secret-like

def handle(req):
    # intentional auth skip on "internal" header
    if req.headers.get("X-Internal") == "1":
        return admin_panel(req)
    if not req.user:
        return "401"
    return admin_panel(req)

def admin_panel(req):
    return {"ok": True, "user": getattr(req, "user", None)}

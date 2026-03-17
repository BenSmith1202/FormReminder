"""
Insert sample opt-out events into your real Firestore so you can see them on
the Analytics page. Use when your test emails are already opted out and you
want to verify the dashboard without triggering real opt-outs.

Run from backend directory (uses .env and real Firestore):

  cd backend
  python tests/seed_opt_out_events_for_analytics.py <your_owner_id>

Get your owner_id: log in to the app, open DevTools (F12) → Network → refresh
the page → click the "current-user" request → Response tab: use the "user"."id" value.
"""
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(THIS_DIR, ".."))
APP_DIR = os.path.join(BACKEND_DIR, "app")
os.chdir(BACKEND_DIR)
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
except ImportError:
    pass

from models.opt_out_event import OptOutEvent


def main():
    if len(sys.argv) < 2:
        print("Usage: python tests/seed_opt_out_events_for_analytics.py <owner_id>")
        print("  owner_id: Your FormReminder user id (same as when logged in).")
        print("  Get it from the app: login, then /api/current-user returns user.id")
        sys.exit(1)
    owner_id = sys.argv[1].strip()
    if not owner_id:
        print("Error: owner_id is required.")
        sys.exit(1)

    # Fake recipients so we don't touch real opted-out emails
    events = [
        ("test-analytics-1@example.com", "opted_out", "recipient", "email_link", None, None),
        ("test-analytics-2@example.com", "opted_out", "recipient", "email_link", None, None),
        ("test-analytics-3@example.com", "left_group", "owner", "owner_dashboard", "group-abc", "Test Group"),
    ]
    for recipient_email, event_type, performed_by, source, group_id, group_name in events:
        OptOutEvent.log(
            owner_id,
            recipient_email,
            event_type,
            performed_by,
            source,
            group_id=group_id,
            group_name=group_name,
        )
    print(f"Inserted {len(events)} sample opt-out events for owner_id={owner_id}")
    print("Open the Analytics page in the app (logged in as this owner) and refresh to see them.")


if __name__ == "__main__":
    main()

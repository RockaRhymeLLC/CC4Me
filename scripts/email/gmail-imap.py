#!/usr/bin/env python3
"""
Gmail IMAP Client with App Password
Usage:
  gmail-imap.py inbox              - Show recent emails
  gmail-imap.py unread             - Show unread emails
  gmail-imap.py read <id>          - Read email by ID
  gmail-imap.py search "query"     - Search emails
  gmail-imap.py send "to" "subject" "body"
  gmail-imap.py delete <id>        - Delete email by ID (move to Trash)
  gmail-imap.py mark-read <id>     - Mark email as read
  gmail-imap.py bulk-delete "query" - Delete all emails matching search
  gmail-imap.py bulk-read "query"   - Mark all matching emails as read
"""

import subprocess
import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
import sys

def get_keychain(key):
    result = subprocess.run(["security", "find-generic-password", "-s", key, "-w"],
        capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None

def decode_subject(subject):
    """Decode email subject header."""
    if not subject:
        return "(no subject)"
    decoded_parts = decode_header(subject)
    result = ""
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            result += part.decode(encoding or 'utf-8', errors='ignore')
        else:
            result += part
    return result

def get_imap_connection():
    """Connect to Gmail IMAP."""
    email_addr = get_keychain("credential-gmail-email")
    password = get_keychain("credential-gmail-app-password")

    if not email_addr or not password:
        print("ERROR: Missing Gmail credentials in Keychain")
        sys.exit(1)

    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(email_addr, password)
    return imap

def cmd_inbox(limit=10):
    """Show recent emails."""
    imap = get_imap_connection()
    imap.select("INBOX")

    status, messages = imap.search(None, "ALL")
    msg_ids = messages[0].split()[-limit:] if messages[0] else []

    print(f"## Inbox ({len(messages[0].split()) if messages[0] else 0} total)\n")

    for msg_id in reversed(msg_ids):
        status, data = imap.fetch(msg_id, "(FLAGS BODY[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if data[0]:
            flags = data[0][0].decode() if data[0][0] else ""
            is_unread = "\\Seen" not in flags
            header = data[0][1].decode(errors='ignore')

            subject = from_addr = date = ""
            for line in header.split('\r\n'):
                if line.startswith('Subject:'):
                    subject = decode_subject(line[9:].strip())
                elif line.startswith('From:'):
                    from_addr = line[6:].strip()
                elif line.startswith('Date:'):
                    date = line[6:].strip()[:20]

            unread_marker = "[UNREAD] " if is_unread else ""
            print(f"{msg_id.decode()}. {unread_marker}From: {from_addr[:40]}")
            print(f"   Subject: {subject[:60]}")
            print(f"   Date: {date}\n")

    imap.logout()

def cmd_unread():
    """Show unread emails."""
    imap = get_imap_connection()
    imap.select("INBOX")

    status, messages = imap.search(None, "UNSEEN")
    msg_ids = messages[0].split() if messages[0] else []

    print(f"## Unread ({len(msg_ids)})\n")

    for msg_id in msg_ids[-10:]:
        status, data = imap.fetch(msg_id, "(BODY[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if data[0]:
            header = data[0][1].decode(errors='ignore')

            subject = from_addr = date = ""
            for line in header.split('\r\n'):
                if line.startswith('Subject:'):
                    subject = decode_subject(line[9:].strip())
                elif line.startswith('From:'):
                    from_addr = line[6:].strip()
                elif line.startswith('Date:'):
                    date = line[6:].strip()[:20]

            print(f"{msg_id.decode()}. From: {from_addr[:40]}")
            print(f"   Subject: {subject[:60]}")
            print(f"   Date: {date}\n")

    imap.logout()

def cmd_read(msg_id):
    """Read a specific email."""
    imap = get_imap_connection()
    imap.select("INBOX")

    status, data = imap.fetch(msg_id.encode(), "(RFC822)")
    if not data[0]:
        print(f"ERROR: Email {msg_id} not found")
        return

    msg = email.message_from_bytes(data[0][1])

    print(f"## Email {msg_id}\n")
    print(f"From: {msg['From']}")
    print(f"To: {msg['To']}")
    print(f"Subject: {decode_subject(msg['Subject'])}")
    print(f"Date: {msg['Date']}")
    print("\n---\n")

    # Get body
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True).decode(errors='ignore')
                print(body[:3000])
                break
    else:
        body = msg.get_payload(decode=True).decode(errors='ignore')
        print(body[:3000])

    imap.logout()

def cmd_search(query):
    """Search emails."""
    imap = get_imap_connection()
    imap.select("INBOX")

    # Gmail supports X-GM-RAW for full search
    try:
        status, messages = imap.search(None, f'X-GM-RAW "{query}"')
    except:
        # Fallback to standard search
        status, messages = imap.search(None, f'(OR SUBJECT "{query}" BODY "{query}")')

    msg_ids = messages[0].split() if messages[0] else []

    print(f"## Search: \"{query}\" ({len(msg_ids)} results)\n")

    for msg_id in msg_ids[-10:]:
        status, data = imap.fetch(msg_id, "(BODY[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if data[0]:
            header = data[0][1].decode(errors='ignore')

            subject = from_addr = date = ""
            for line in header.split('\r\n'):
                if line.startswith('Subject:'):
                    subject = decode_subject(line[9:].strip())
                elif line.startswith('From:'):
                    from_addr = line[6:].strip()
                elif line.startswith('Date:'):
                    date = line[6:].strip()[:20]

            print(f"{msg_id.decode()}. From: {from_addr[:40]}")
            print(f"   Subject: {subject[:60]}")
            print(f"   Date: {date}\n")

    imap.logout()

def cmd_send(to, subject, body):
    """Send an email via SMTP."""
    email_addr = get_keychain("credential-gmail-email")
    password = get_keychain("credential-gmail-app-password")

    msg = MIMEMultipart()
    msg['From'] = email_addr
    msg['To'] = to
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465)
    smtp.login(email_addr, password)
    smtp.sendmail(email_addr, to, msg.as_string())
    smtp.quit()

    print(f"✓ Sent to {to}")

def cmd_delete(msg_id):
    """Delete email by moving to Trash."""
    imap = get_imap_connection()
    imap.select("INBOX")

    # Move to Gmail Trash
    status, _ = imap.store(msg_id.encode(), '+X-GM-LABELS', '\\Trash')
    if status == 'OK':
        imap.store(msg_id.encode(), '+FLAGS', '\\Deleted')
        imap.expunge()
        print(f"✓ Deleted email {msg_id}")
    else:
        print(f"ERROR: Could not delete {msg_id}")

    imap.logout()

def cmd_mark_read(msg_id):
    """Mark email as read."""
    imap = get_imap_connection()
    imap.select("INBOX")

    status, _ = imap.store(msg_id.encode(), '+FLAGS', '\\Seen')
    if status == 'OK':
        print(f"✓ Marked {msg_id} as read")
    else:
        print(f"ERROR: Could not mark {msg_id} as read")

    imap.logout()

def cmd_bulk_delete(query):
    """Delete all emails matching search query."""
    imap = get_imap_connection()
    imap.select("INBOX")

    try:
        status, messages = imap.search(None, f'X-GM-RAW "{query}"')
    except:
        status, messages = imap.search(None, f'(OR SUBJECT "{query}" FROM "{query}")')

    msg_ids = messages[0].split() if messages[0] else []

    if not msg_ids:
        print(f"No emails found matching: {query}")
        imap.logout()
        return

    print(f"Deleting {len(msg_ids)} emails matching: {query}")

    for msg_id in msg_ids:
        imap.store(msg_id, '+X-GM-LABELS', '\\Trash')
        imap.store(msg_id, '+FLAGS', '\\Deleted')

    imap.expunge()
    print(f"✓ Deleted {len(msg_ids)} emails")

    imap.logout()

def cmd_bulk_read(query):
    """Mark all matching emails as read."""
    imap = get_imap_connection()
    imap.select("INBOX")

    try:
        status, messages = imap.search(None, f'X-GM-RAW "{query}"')
    except:
        status, messages = imap.search(None, f'(OR SUBJECT "{query}" FROM "{query}")')

    msg_ids = messages[0].split() if messages[0] else []

    if not msg_ids:
        print(f"No emails found matching: {query}")
        imap.logout()
        return

    print(f"Marking {len(msg_ids)} emails as read...")

    for msg_id in msg_ids:
        imap.store(msg_id, '+FLAGS', '\\Seen')

    print(f"✓ Marked {len(msg_ids)} emails as read")

    imap.logout()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "inbox":
        limit = int(sys.argv[2]) if len(sys.argv) >= 3 else 10
        cmd_inbox(limit)
    elif cmd == "unread":
        cmd_unread()
    elif cmd == "read" and len(sys.argv) >= 3:
        cmd_read(sys.argv[2])
    elif cmd == "search" and len(sys.argv) >= 3:
        cmd_search(sys.argv[2])
    elif cmd == "send" and len(sys.argv) >= 5:
        cmd_send(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "delete" and len(sys.argv) >= 3:
        cmd_delete(sys.argv[2])
    elif cmd == "mark-read" and len(sys.argv) >= 3:
        cmd_mark_read(sys.argv[2])
    elif cmd == "bulk-delete" and len(sys.argv) >= 3:
        cmd_bulk_delete(sys.argv[2])
    elif cmd == "bulk-read" and len(sys.argv) >= 3:
        cmd_bulk_read(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)

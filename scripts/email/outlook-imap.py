#!/usr/bin/env python3
"""
Outlook IMAP Client with OAuth2
Usage:
  outlook-imap.py inbox          - Show recent emails
  outlook-imap.py unread         - Show unread emails
  outlook-imap.py read <id>      - Read email by ID
  outlook-imap.py search "query" - Search emails
  outlook-imap.py send "to" "subject" "body"
"""

import subprocess
import urllib.request
import urllib.parse
import json
import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
import sys
import re

def get_keychain(key):
    result = subprocess.run(["security", "find-generic-password", "-s", key, "-w"],
        capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None

def set_keychain(key, value):
    subprocess.run(["security", "add-generic-password", "-a", "r2d2",
        "-s", key, "-w", value, "-U"], check=True)

def get_access_token():
    """Get fresh access token using refresh token."""
    client_id = get_keychain("credential-outlook-client-id")
    refresh_token = get_keychain("credential-outlook-refresh-token")

    if not client_id or not refresh_token:
        print("ERROR: Missing Outlook credentials in Keychain")
        sys.exit(1)

    token_url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "scope": "offline_access https://outlook.office.com/IMAP.AccessAsUser.All"
    }).encode()

    req = urllib.request.Request(token_url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        token_response = json.loads(resp.read().decode())
        # Store new refresh token if provided
        if "refresh_token" in token_response:
            set_keychain("credential-outlook-refresh-token", token_response["refresh_token"])
        return token_response["access_token"]

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
    """Connect to Outlook IMAP with OAuth2."""
    email_addr = get_keychain("credential-outlook-email")
    access_token = get_access_token()

    def oauth2_string(user, token):
        return f"user={user}\x01auth=Bearer {token}\x01\x01"

    imap = imaplib.IMAP4_SSL("outlook.office365.com")
    imap.authenticate("XOAUTH2", lambda x: oauth2_string(email_addr, access_token).encode())
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

    # Search in subject and body
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
    email_addr = get_keychain("credential-outlook-email")
    access_token = get_access_token()

    msg = MIMEMultipart()
    msg['From'] = email_addr
    msg['To'] = to
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    # Connect to Outlook SMTP with OAuth2
    smtp = smtplib.SMTP("smtp-mail.outlook.com", 587)
    smtp.starttls()

    # OAuth2 authentication
    auth_string = f"user={email_addr}\x01auth=Bearer {access_token}\x01\x01"
    smtp.docmd("AUTH", "XOAUTH2 " + __import__('base64').b64encode(auth_string.encode()).decode())

    smtp.sendmail(email_addr, to, msg.as_string())
    smtp.quit()

    print(f"✓ Sent to {to}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "inbox":
        cmd_inbox()
    elif cmd == "unread":
        cmd_unread()
    elif cmd == "read" and len(sys.argv) >= 3:
        cmd_read(sys.argv[2])
    elif cmd == "search" and len(sys.argv) >= 3:
        cmd_search(sys.argv[2])
    elif cmd == "send" and len(sys.argv) >= 5:
        cmd_send(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
        sys.exit(1)

#!/usr/bin/env python3
"""
Outlook OAuth2 Device Code Flow
Authenticates a user and stores refresh token in macOS Keychain.
"""

import subprocess
import json
import time
import urllib.request
import urllib.parse
import sys

def get_keychain(key):
    """Get value from macOS Keychain."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", key, "-w"],
            capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None

def set_keychain(key, value):
    """Set value in macOS Keychain."""
    subprocess.run(
        ["security", "add-generic-password", "-a", "r2d2", "-s", key, "-w", value, "-U"],
        check=True
    )

def device_code_flow():
    """Run the OAuth2 device code flow."""
    tenant_id = get_keychain("credential-outlook-tenant-id")
    client_id = get_keychain("credential-outlook-client-id")

    if not tenant_id or not client_id:
        print("ERROR: Missing tenant_id or client_id in Keychain")
        sys.exit(1)

    # Step 1: Request device code
    device_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode"
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "scope": "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send"
    }).encode()

    req = urllib.request.Request(device_url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        device_response = json.loads(resp.read().decode())

    # Show user instructions
    print("\n" + "="*60)
    print("OUTLOOK AUTHORIZATION REQUIRED")
    print("="*60)
    print(f"\n1. Open: {device_response['verification_uri']}")
    print(f"2. Enter code: {device_response['user_code']}")
    print(f"\nCode expires in {device_response['expires_in'] // 60} minutes")
    print("="*60 + "\n")
    print("Waiting for authorization...")

    # Step 2: Poll for token
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    interval = device_response.get("interval", 5)

    while True:
        time.sleep(interval)

        token_data = urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id,
            "device_code": device_response["device_code"]
        }).encode()

        token_req = urllib.request.Request(token_url, data=token_data, method="POST")

        try:
            with urllib.request.urlopen(token_req) as resp:
                token_response = json.loads(resp.read().decode())

                # Success! Store the refresh token
                refresh_token = token_response.get("refresh_token")
                if refresh_token:
                    set_keychain("credential-outlook-refresh-token", refresh_token)
                    print("\n✓ Authorization successful!")
                    print("✓ Refresh token stored in Keychain")
                    return True
                else:
                    print("ERROR: No refresh token in response")
                    return False

        except urllib.error.HTTPError as e:
            error_body = json.loads(e.read().decode())
            error_code = error_body.get("error")

            if error_code == "authorization_pending":
                print(".", end="", flush=True)
                continue
            elif error_code == "slow_down":
                interval += 5
                continue
            elif error_code == "expired_token":
                print("\nERROR: Device code expired. Please try again.")
                return False
            else:
                print(f"\nERROR: {error_body.get('error_description', error_code)}")
                return False

if __name__ == "__main__":
    device_code_flow()

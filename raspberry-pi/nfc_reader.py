import sys
import time
import requests
import os
from dotenv import load_dotenv

# Try to import pypcard/pyscard
try:
    from smartcard.System import readers
    from smartcard.util import toHexString
except ImportError:
    print("Warning: pyscard library not found. Running in SIMULATION mode.")
    print("To install pyscard, run: pip install pyscard")
    readers = None

# Load configurations
load_dotenv()
BACKEND_URL = os.getenv("BACKEND_URL", "http://<your-server-ip>:5000/api")
DEVICE_SECRET = os.getenv("NFC_DEVICE_SECRET", "shakthi_nfc_hardware_device_secret_key_12345")
SCAN_COOLDOWN_SEC = int(os.getenv("SCAN_COOLDOWN_SEC", "3"))

print("==========================================================")
print("     SRI SHAKTHI SMART MESS - NFC READER GATEWAY          ")
print("==========================================================")
print(f"Backend Server: {BACKEND_URL}")
print(f"Scan Cooldown:  {SCAN_COOLDOWN_SEC} seconds")

# Cache to prevent rapid duplicate scans
last_scans = {}

def send_nfc_to_backend(uid_str):
    now = time.time()
    if uid_str in last_scans:
        elapsed = now - last_scans[uid_str]
        if elapsed < SCAN_COOLDOWN_SEC:
            # Silent cooldown block to prevent spamming
            return

    last_scans[uid_str] = now
    print(f"\n[{time.strftime('%H:%M:%S')}] Scanned NFC Card UID: {uid_str}")
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/nfc/scan",
            json={"nfc_uid": uid_str},
            headers={"x-nfc-device-key": DEVICE_SECRET},
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            print("🟢 Verification Success!")
            print(f"   Student:     {data.get('student_name')}")
            print(f"   Roll Number: {data.get('roll_number')}")
            print(f"   Entry Time:  {data.get('entry_time')}")
            print(f"   Meal Period: {data.get('meal_type', '').upper()}")
        else:
            err_data = response.json()
            print(f"🔴 Verification Failed: {err_data.get('error', 'Unknown Error')}")
            
    except Exception as e:
        print(f"🔴 Connection Error: Could not reach backend server. {str(e)}")

def start_polling():
    if not readers:
        # Simulation Mode
        print("\n=== SYSTEM RUNNING IN SIMULATION MODE ===")
        print("Type a mock UID (e.g. 04A12B34C56D) and press Enter to simulate a tap.")
        print("Press Ctrl+C to exit.\n")
        try:
            while True:
                mock_uid = input("Simulated NFC Card Tap -> ").strip()
                if mock_uid:
                    send_nfc_to_backend(mock_uid)
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("\nExiting Simulation Mode.")
            return

    # Real ACR1252U Polling Loop
    print("\nDetecting readers...")
    r = readers()
    if len(r) == 0:
        print("Error: No NFC readers found. Please plug in the ACR1252U device.")
        sys.exit(1)
        
    reader = r[0]
    print(f"Using NFC Reader: {reader}")
    print("Continuous listening started. Tap an ID card on the scanner...")
    
    connection = None
    try:
        while True:
            try:
                connection = reader.createConnection()
                connection.connect()
                # Get Card UID command (Standard ISO14443 APDU)
                GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
                data, sw1, sw2 = connection.transmit(GET_UID)
                uid = toHexString(data).replace(" ", "").upper()
                if uid:
                    send_nfc_to_backend(uid)
                # Small wait to allow card removal before polling again
                time.sleep(0.5)
            except Exception:
                # No card detected, sleep and retry
                time.sleep(0.2)
    except KeyboardInterrupt:
        print("\nExiting listener.")

if __name__ == "__main__":
    start_polling()

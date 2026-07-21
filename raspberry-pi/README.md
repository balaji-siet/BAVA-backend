# ACR1252U NFC Reader Gateway on Raspberry Pi 5

This folder contains the gateway script that runs on the Raspberry Pi 5 to poll the ACR1252U NFC reader and send scanned card UIDs to the central hostel mess backend.

## Requirements

### Hardware
1. Raspberry Pi 5 (running Raspberry Pi OS)
2. ACR1252U USB NFC Reader

### Software Dependencies
Install the required system PC/SC daemon and development libraries:
```bash
sudo apt-get update
sudo apt-get install pcscd libpcsclite-dev python3-pip -y
```

Install python packages:
```bash
pip3 install -r requirements.txt
```

## Running the Gateway

1. Make sure your environment configurations are set up in a `.env` file:
   ```env
   BACKEND_URL=http://<laptop_lan_ip>:5000/api
   SCAN_COOLDOWN_SEC=3
   DEVICE_SECRET=rpi_mess_secure_gate_key_9988
   ```
2. Start the listener script:
   ```bash
   python3 nfc_reader.py
   ```

## Autostart Service Setup
To ensure the NFC system runs 24/7, set it up as a systemd service:

1. Create a service file:
   ```bash
   sudo nano /etc/systemd/system/nfc-reader.service
   ```
2. Paste the following configuration:
   ```ini
   [Unit]
   Description=Hostel Mess NFC Scanner Gateway
   After=network.target pcscd.service

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/smart-mess-rpi
   ExecStart=/usr/bin/python3 nfc_reader.py
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable nfc-reader.service
   sudo systemctl start nfc-reader.service
   ```

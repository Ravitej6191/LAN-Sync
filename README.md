# LAN Share

Send files and text between your own devices. Runs on your PC, no internet, no accounts, no database.

## Start it

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Double-click `start.bat` (or run `node server.js` in this folder).
3. Your browser opens. Files you send are saved in the `shared` folder.

To start it automatically with Windows, run `add-to-startup.bat` (undo with `remove-from-startup.bat`).

## Use it on your phone (same WiFi)

- Open the **Scan QR** panel on the PC and scan the code with your phone camera, or type one of the addresses shown.
- The `PCNAME.local` style address (your PC's name) keeps working when the router changes the PC's IP.
- The "Encrypted" addresses (`https://...:3443`) use a certificate made on this PC. Your phone shows a one-time warning; choose Advanced, then continue.

## Use it from anywhere with Tailscale

Tailscale is a free private network between your own devices. Nothing is exposed to the public internet, and no code changes are needed.

1. **Install Tailscale on the PC** from tailscale.com/download and sign in.
2. **Install Tailscale on the phone** (App Store / Google Play) and sign in with the **same account**. Turn it on.
3. **Keep LAN Share running on the PC** (`start.bat`, or `add-to-startup.bat` so it starts with Windows).
4. **Find the PC's Tailscale address.** In the Tailscale app on the phone, tap the PC in the device list and copy its address (it starts with `100.`). On the PC you can also run `tailscale ip -4` in a terminal.
5. **Open it on the phone:** `http://100.x.x.x:3000` (use the address from step 4). You can also try `http://pcname:3000` (your PC's name), which works when Tailscale's "MagicDNS" is on (it is by default).
6. **Bookmark it**, or use Add to Home screen.

Notes:

- Use `http://` over Tailscale. Tailscale already encrypts everything between your devices.
- If the page won't open, Windows Firewall may be blocking port 3000 for the Tailscale network. Run this once in a terminal opened as Administrator (it only allows Tailscale addresses):

  ```
  netsh advfirewall firewall add rule name="LAN Share (Tailscale)" dir=in action=allow protocol=TCP localport=3000 remoteip=100.64.0.0/10
  ```

- The PC must be on and signed in to Tailscale. If the PC was asleep or the server was not running, nothing will open.
- The PC's own browser is always the "host": only it can see Settings, Clear all, and approve or block devices. A phone coming in over Tailscale is a normal device.
- If you want only your approved devices to join, turn on **Ask before new devices join** (and optionally a 4-digit PIN) in the Devices panel.
- If Tailscale is installed after the server was started, restart the server once so it recognises the new address.

## License and credits

LAN Share is released under the [MIT License](LICENSE).

It bundles one third-party library, copied locally so it works offline: **qrcode-generator** by Kazuhiko Arase (`qrcode.js`), also MIT licensed. Its licence notice is kept at the top of that file. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## Do not publish these

If you put this folder in a Git repository, leave out:

- `shared/` (your files, notes, settings, approvals)
- `cert/` (the private key for the encrypted addresses)

## Not for the public internet

LAN Share has no login. It decides who is the host by checking whether a request comes from the PC itself. Behind a public hosting service or tunnel, every visitor looks like the PC, so do not put it on one. Use Tailscale or your home WiFi.

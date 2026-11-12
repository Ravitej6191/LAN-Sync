# LAN Share

Send files and text between your own devices. No accounts, no uploads to anyone's server.

There are two versions. Pick the one that fits:

| | **Web version** | **PC version** |
|---|---|---|
| Where | [ravitej6191.github.io/LAN-Sync](https://ravitej6191.github.io/LAN-Sync/) | `server.js` in this repo |
| Install | Nothing, just open the page | Node.js 18+, then `start.bat` |
| How it connects | Two devices pair with a code or QR, then talk directly (peer to peer) | Phones open the PC's address |
| Where files go | Straight to the other device, nothing stored | Saved in the `shared` folder on the PC |
| History, folders, device list | No (kept only while the page is open) | Yes |
| Several devices at once | Pair each one | Yes, everyone on the WiFi |
| Needs the PC on | No | Yes |

## Web version

Open **https://ravitej6191.github.io/LAN-Sync/** on two devices, for example your phone and your laptop.

1. On both devices tap **Connect a device**.
2. On the first device choose **Start: show a code**. It shows a QR and a text code.
3. On the second device choose **Join: enter a code**, then **Scan with camera** (or paste the code).
4. The second device now shows a **reply code**. On the first device, scan or paste it and tap **Connect**.
5. You are connected. Choose files or type a note and send. Received files show a **Save** button.

You can connect more devices by repeating this for each one. With two or more connected, a **Send to** row lets you pick Everyone or a single device.

How it works and what it protects:

- Files and text go directly from one device to the other over WebRTC, which is encrypted end to end. No server sees or stores them.
- The page itself is served by GitHub Pages. After your first visit it is cached, so it keeps working without internet. You can also install it from your browser (Add to Home screen). On Android, an installed copy appears in the Share menu.
- A code holds connection details (your device's local network address and a one-time key fingerprint) but no files. Anyone who gets **both** codes during pairing could connect, so only share them between your own devices.
- By default it only looks for devices on the same network. The tick-box *Also allow devices on different networks* uses a public Google STUN server to find the way, which reveals your public IP address to that server.
- Nothing is saved. Close the page and received files, notes and the list of devices are gone.

Limits:

- Both devices must keep the page open while sending.
- A received file is held in memory until you save it, so very large files (over about 2 GB) will not work.
- Some routers stop devices on the same WiFi from reaching each other (called client or AP isolation, often on guest WiFi). Pairing then fails. Try the *different networks* tick-box, or use the PC version.

If it will not connect: make sure both devices are on the same WiFi, keep the first device's page open until the reply code is entered, and start again with fresh codes if anything went wrong (a start code works for one device). If the camera does not open, allow camera access for the page, or paste the code instead.

## PC version

A small Node.js server on your PC. Phones and other devices open its address. It stores files, shows who is connected, and keeps folders, notes and history. No internet, no accounts, no database.

### Start it

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Double-click `start.bat` (or run `node server.js` in this folder).
3. Your browser opens. Files you send are saved in the `shared` folder.

To start it automatically with Windows, run `add-to-startup.bat` (undo with `remove-from-startup.bat`).

### Use it on your phone (same WiFi)

- Open the **Scan QR** panel on the PC and scan the code with your phone camera, or type one of the addresses shown.
- The `PCNAME.local` style address (your PC's name) keeps working when the router changes the PC's IP.
- The "Encrypted" addresses (`https://...:3443`) use a certificate made on this PC. Your phone shows a one-time warning; choose Advanced, then continue.

### Use it from anywhere with Tailscale

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

### Not for the public internet

The PC version has no login. It decides who is the host by checking whether a request comes from the PC itself. Behind a public hosting service or tunnel, every visitor looks like the PC, so do not put it on one. Use Tailscale or your home WiFi. (The web version has no server, so this does not apply to it.)

### If you put your copy in a Git repository

Leave these out (this repo's `.gitignore` already does):

- `shared/` (your files, notes, settings, approvals)
- `cert/` (the private key for the encrypted addresses)

## What is in this repo

- `server.js`, `index.html`, `app/`, `*.bat`, `start-hidden.vbs`: the PC version.
- `docs/`: the web version, published by GitHub Pages from this folder.

## License and credits

LAN Share is released under the [MIT License](LICENSE).

It bundles third-party libraries, copied locally so they work offline: **qrcode-generator** by Kazuhiko Arase (`qrcode.js`, MIT; its notice is kept at the top of that file) and, in the web version, **jsQR** by Cosmo Wolfe (`docs/jsQR.js`, Apache-2.0; licence in `docs/LICENSE-jsQR.txt`). "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

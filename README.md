# Monopoli: Pengen Sugih

Game papan jual-beli properti online untuk 2–4 pemain, bergaya pixel art, dengan papan bertema kota-kota Indonesia. Main langsung dari browser desktop atau HP tanpa instalasi dan tanpa akun: host membuat room, membagikan link atau kode 6 huruf, lalu semua pemain memilih karakter dan mulai.

> Parodi, tidak berafiliasi dengan tokoh mana pun maupun pemilik merek Monopoly. Tanpa uang sungguhan, top-up, atau taruhan.

## Fitur (versi 1.0)

- **Room online**: buat room 1 klik, link `/r/KODE` + kode 6 huruf, tombol salin & kirim ke WhatsApp. Host bisa mengatur aturan di lobi dan peran host pindah otomatis bila host keluar.
- **Karakter**: 7 karikatur tokoh + 4 karakter warga (Pak RT, Bu Lurah, Juragan, Mahasiswa), urutan diacak, satu karakter per pemain. Editor karakter custom (bentuk wajah, kulit, rambut, peci/kerudung/topi, kacamata, kumis, baju). Paket tokoh bisa dimatikan lewat env `CHARACTER_PACKS=generik` tanpa rilis ulang.
- **Aturan lengkap** dijalankan server: angka kembar & kembar 3×, penjara (denda 500, kartu Bebas, 3 percobaan), lelang 15 detik, sewa grup lengkap 2×, ambil alih properti lawan seharga 2× (tanah + bangunan, dibayar ke pemilik) setelah bayar sewa, upgrade bangunan hanya saat berhenti di kota sendiri (satu level per singgah: Rumah → Hotel → Mall → Landmark), kota ber-Landmark kebal ambil alih, jual bangunan 50%, hipotek 50% + bunga 10%, 32 kartu Kesempatan/Dana Umum bernuansa Indonesia, utang & bangkrut (ke pemain atau ke bank dengan lelang ulang), tukar-menukar properti/uang/kartu Bebas.
- **Pengaturan room**: jumlah pemain, uang awal 10/15/20 ribu, lelang, jackpot Parkir Bebas, gaji ganda di START, batas waktu permainan 30/60/90 menit (pemenang = total aset), batas waktu giliran 30/60/90 detik.
- **Reconnect**: pemain terputus punya 120 detik untuk kembali (cukup buka link lagi); selama itu gilirannya dilewati tanpa membeli apa pun.
- **Chat & emoji reaksi**, penyaring kata kasar, rate limit per koneksi.
- **Pixel art & audio orisinal**: papan 480×480 dengan ikon landmark tiap kota, peta Indonesia di tengah yang menyala sesuai pemilik, rumah, hotel, mall & landmark 3D voxel tiap kota (dengan animasi landmark berputar), animasi dadu 8 frame, kartu yang terbalik, bidak dengan animasi idle & lompat, musik chiptune pelog, dan efek suara. Mute musik & efek terpisah (tersimpan di browser).
- **Keadilan**: dadu & pengocokan kartu memakai RNG kriptografis di server (SHA-256 dari seed 256-bit acak), seed dicatat di log permainan.

## Menjalankan

Butuh Node.js 20+.

```bash
npm install
npm run dev        # server :3000 + Vite :5173 (buka http://localhost:5173)
npm test           # unit test mesin aturan & server
npm run build && npm start   # produksi di http://localhost:3000
```

### Docker / Dokploy

```bash
docker compose up -d --build
```

Image melayani klien & WebSocket di port 3000, menyimpan data di volume `/data`. Arahkan Cloudflare Tunnel ke `http://<host>:3000`.

| Env | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP/WebSocket |
| `DATA_DIR` | `./data` | Snapshot room aktif (`rooms.json`) & riwayat permainan (`history/`) |
| `CHARACTER_PACKS` | `tokoh,generik` | Paket karakter yang aktif |
| `MAX_ROOMS` | `200` | Batas room bersamaan |

## Arsitektur

```
theme/indonesia.json     data papan: 40 petak, harga, sewa, kartu, ikon (tema baru = file JSON baru)
theme/characters.json    data karakter (tambah tokoh tanpa ubah kode)
src/shared/engine.ts     mesin aturan TypeScript murni, dipakai server (otoritatif) & klien (validasi tombol)
src/server/              Express + Socket.IO: room, lobi, timer giliran/lelang, reconnect, chat, persistensi
src/client/              Vite + TypeScript, papan di Canvas 2D, panel UI di HTML/CSS
tests/                   Vitest: aturan, simulasi acak, room & reconnect
```

Klien hanya mengirim niat aksi (`roll`, `buy`, `bid`, `build`, …); server memvalidasi, mengacak, lalu menyiarkan state ke semua pemain di room. Urutan dek kartu tidak pernah dikirim ke klien.

**Penyimpanan**: state room aktif disimpan sebagai snapshot JSON tiap 10 detik dan saat server berhenti, lalu dipulihkan saat start (pemain punya 120 detik untuk kembali). Riwayat permainan (seed, log, peringkat) ditulis ke `DATA_DIR/history` dan dihapus otomatis setelah 30 hari. PRD menyarankan Redis + SQLite/PostgreSQL; lapisan ini sengaja dibuat sederhana dulu agar cukup satu container, dan bisa diganti tanpa menyentuh mesin aturan.

## Belum termasuk

- Unggah foto lalu di-pixelate untuk karakter custom (fase 2 di PRD).
- Bot pengisi slot, turnamen, ranking global (di luar cakupan v1.0).
- Sprite karikatur tokoh saat ini digambar prosedural dari potongan wajah. Untuk kemiripan yang lebih kuat, gambar ulang sprite 32×32 per tokoh di Piskel/LibreSprite dengan prinsip netral yang sama.

Lihat `CREDITS.md` untuk sumber & lisensi aset.

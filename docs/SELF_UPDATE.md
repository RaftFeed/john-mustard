# Self-Update (Owner)

Bot bisa ngedit kodenya sendiri lewat **Hermes Agent** di VPS, dengan gerbang test + auto-rollback.
Konsepnya: **bot trigger & lapor, Hermes yang eksekusi.** Bot gak bisa ngawasi restart dirinya
sendiri (prosesnya mati saat restart), jadi restart dijadwalkan *detached* oleh script di host.

## Alur 2 fase

1. **`#selfupdate <instruksi>`** (owner-only)
   Bot ngirim playbook ketat ke Hermes: baca kode → edit → jalankan test gate → lapor ringkas.
   **Belum ada yang di-deploy.** Review dulu hasilnya.

2. **`#deploy`** (owner-only)
   Menjalankan `scripts/self-update.sh deploy` di VPS:
   ```
   guard file terproteksi -> commit working tree -> test gate -> (restart | skip) -> health check
                                                                              └─ gagal = auto-rollback
   ```
   - `#deploy status` buat lihat hasil deploy terakhir + log.

## Guardrail

- **Owner-only** (`isOwner`) untuk `#selfupdate`, `#deploy`, dan tool `manageRemoteServer`.
- **File terproteksi** — deploy *abort* kalau `.env` atau `docker-compose.yml` ikut berubah.
  Hermes juga dilarang menyentuh `key-oracle/`, `9router-data/`, `oauth_session_vps.json`, `*.bak-*`.
- **Test gate wajib hijau** — `node --test tests/*.test.js` di container `node:24-slim`.
  Gagal = commit di-`git reset --hard` balik, bot gak pernah kesentuh.
- **Auto-rollback** — kalau `/health` (port 4500) gak balas setelah restart, script balikin ke commit sebelumnya + restart ulang.
- **Single-flight lock** — gak bisa deploy barengan.
- **Audit** — `data/self-update.log` + `data/self-update.status`.

## Catatan operasional

- Restart dijadwalkan **20 detik** setelah tes lulus, biar balasan WhatsApp keburu kekirim.
  Atur lewat `SELF_UPDATE_RESTART_DELAY`.
- Kalau perubahan cuma di luar `src/` (mis. `skills/`, `system-prompt.md`), **restart dilewati** —
  karena `src/` bind-mounted dan prompt dibaca per request.
- Rollback manual kapan saja: `git reset --hard <commit> && docker compose up -d --no-deps --force-recreate bot`.
- Commit self-update **cuma lokal di VPS** (belum di-push ke GitHub). Pull manual kalau mau sinkron ke dev.
- Test gate sengaja cuma unit test (`node --test tests/*.test.js`); `python scripts/test_runner.py`
  butuh service hidup jadi gak dipakai sebagai gate.

## Struktur file

- `scripts/self-update.sh` — pipeline (status / deploy / notify).
- `scripts/self-update-watch.sh` — watcher detached: restart → health check → rollback → notifikasi WA.
- `src/commands.js` — fast command `#selfupdate` & `#deploy` + playbook prompt Hermes.

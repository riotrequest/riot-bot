# App updates

**Settings → Updates** shows the installed version and how that copy gets new ones.

## Preview installs (not code-signed)

The preview releases in [riotrequest/riot-bot](https://github.com/riotrequest/riot-bot/releases) are not code-signed, and a copy installed from one does not update itself. To update, download the newer `Riot-Bot-Setup-<version>.exe` and run it. Your bots and data stay in `%APPDATA%\riot-bot\`. Quit Riot Bot from the tray first so no work is interrupted.

Windows SmartScreen shows “Windows protected your PC” for an unsigned installer. Choose **More info**, then **Run anyway**. Each release lists the installer’s SHA-256 checksum; compare it with `Get-FileHash .\Riot-Bot-Setup-<version>.exe -Algorithm SHA256` before you run the file.

## Signed installs

A signed Windows install checks the public releases once at startup and again when you choose **Check for updates**. Choose **Download update** and then **Restart and install**. Riot Bot checks the installer’s Authenticode signature against the publisher of the running app. The restart closes the window, waits for the app to close its local service, and starts the installer only after a clean shutdown. It is refused while work is running or queued.

No signed release has been published yet. A copy installed from a preview release needs one manual install of the first signed version; after that it updates itself.

## Source checkouts

Pull the new code, run `npm ci`, and restart the app.

## Publish a preview release

1. On a reviewed release commit, set the new version in both `package.json` and `package-lock.json`. Use a higher version than the last published release.
2. Move any older files out of `release/`, then run `npm ci` followed by `npm run dist:win` on Windows. This writes `release\Riot-Bot-Setup-<version>.exe` without a signature and without the update files.
3. Install that file in a clean Windows account. Check first run, the optional Chromium download, and uninstall. Installing over the previous version must keep its data.
4. Record the checksum with `Get-FileHash release\Riot-Bot-Setup-<version>.exe -Algorithm SHA256`.
5. Create a draft GitHub Release tagged `v<version>` for that commit. Attach only the installer, and put the checksum and the SmartScreen note in the release text. Do not attach a `latest.yml`. Publish the draft once it is complete.

## Publish a signed release

1. On a reviewed release commit, set the new version in both `package.json` and `package-lock.json`. Use a higher version than the last published release.
2. Configure the authorized Windows signing identity and run `npm ci` followed by `npm run dist:win:release` on Windows. The build signs the app and installer and writes the release files locally.
3. Verify that the packaged `Riot Bot.exe` and `Riot-Bot-Setup-<version>.exe` both have a valid Authenticode signature from the same publisher. Check the fresh install and upgrade in a test profile before publishing.
4. Create a draft GitHub Release tagged `v<version>` for that commit. Attach the installer, its `.blockmap`, and `latest.yml` from the same build in `release/`. Publish the draft as a normal release once all files are in place.

The first signed installer establishes the update channel. Keep the same certificate subject across releases. If the publisher identity changes, users need to install a new trusted build manually.

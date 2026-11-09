# App updates

**Settings → Updates** shows the installed version and how that copy gets new ones.

## Signed installs

A copy installed from a signed Windows release checks the public releases in [riotrequest/riot-bot](https://github.com/riotrequest/riot-bot/releases) once at startup and again when you choose **Check for updates**. Choose **Download update** and then **Restart and install**. Riot Bot checks the installer’s Authenticode signature against the publisher of the running app. The restart closes the window, waits for the app to close its local service, and starts the installer only after a clean shutdown. It is refused while work is running or queued.

No signed release has been published yet.

## Source checkouts and local builds

A source checkout and an installer you built yourself do not update themselves. For source, pull the new code, run `npm ci`, and restart the app.

`npm run dist:win` writes an unsigned installer to `release\`. It is for your own computer: nothing in it proves who built it, so don’t publish it or pass it on. To update a copy installed from it, pull the new code, build again and run the new installer. Your bots and data stay in `%APPDATA%\riot-bot\`. Windows SmartScreen may warn about the file because it has no signature.

## Publish a Windows update

Every public installer is signed. Do not attach an unsigned build to a GitHub Release.

1. On a reviewed release commit, set the new version in both `package.json` and `package-lock.json`. Use a higher version than the last published release.
2. Configure the authorized Windows signing identity and run `npm ci` followed by `npm run dist:win:release` on Windows. The build signs the app and installer and writes the release files locally.
3. Verify that the packaged `Riot Bot.exe` and `Riot-Bot-Setup-<version>.exe` both have a valid Authenticode signature from the same publisher. Check the fresh install and upgrade in a test profile before publishing.
4. Create a draft GitHub Release tagged `v<version>` for that commit. Attach the installer, its `.blockmap`, and `latest.yml` from the same build in `release/`. Publish the draft as a normal release once all files are in place.

The first signed installer establishes the update channel. Keep the same certificate subject across releases. If the publisher identity changes, users need to install a new trusted build manually.

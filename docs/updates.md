# App updates

**Settings → Updates** shows the installed version and checks the public releases in [riotrequest/riot-bot](https://github.com/riotrequest/riot-bot/releases). Official Windows installs also check once at startup. Choose **Download update** and then **Restart and install**. Riot Bot checks the installer’s Authenticode signature against the publisher of the running app. The restart waits for the app to close its local service and is refused while work is running or queued.

Source checkouts and local development installers use the existing manual update path. For source, pull the new code, run `npm ci`, and restart the app.

## Publish a Windows update

1. On a reviewed release commit, set the new version in both `package.json` and `package-lock.json`. Use a higher version than the last published release.
2. Configure the authorized Windows signing identity and run `npm ci` followed by `npm run dist:win:release` on Windows. The build signs the app and installer and writes the release files locally.
3. Verify that the packaged `Riot Bot.exe` and `Riot-Bot-Setup-<version>.exe` both have a valid Authenticode signature from the same publisher. Check the fresh install and upgrade in a test profile before publishing.
4. Create a draft GitHub Release tagged `v<version>` for that commit. Attach the installer, its `.blockmap`, and `latest.yml` from the same build in `release/`. Publish the draft as a normal release once all files are in place.

The first signed installer establishes the update channel. Keep the same certificate subject across releases. If the publisher identity changes, users need to install a new trusted build manually.

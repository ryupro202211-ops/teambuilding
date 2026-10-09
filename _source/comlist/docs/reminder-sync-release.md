# リマインド同期の反映手順

## 今回の変更

- リマインド完了を、書き込み合言葉を設定した端末間で共有する。
- 開いたとき・画面に戻ったとき・60秒ごと・完了操作時に同期する。
- 「リマインドを同期」から手動で同期できる。
- 送信失敗時は暗号化した端末の記録とバッジを残し、再試行できる。
- 以前の端末内の完了記録も引き継ぐ。
- 名前や日付は送信せず、SHA-256 の識別子と完了状態だけを送る。

## 検証

同期・再試行・旧記録移行・不正ID拒否のテストを追加。全527件のテストと、PC・スマホの実ブラウザ検証が成功した。初回同期中に完了操作した場合の再確認を追加した後も、`node --test test/reminder_sync.test.js` の3件が成功した。

## 反映手順

1. Apps Script の既存プロジェクト「マイベストライフ」を開く。
   <https://script.google.com/home/projects/1LZqfabFE7-C5fff1LghW5lZ2YuWu6nT3avb1wD2qY7pM5o51-l6yDod_/edit>
2. `ReminderSync.gs` を追加し、同期APIを貼り付けて保存する操作まで実施した。ブラウザが応答しなくなったため、既存の clasp 認証による Apps Script API で保存を確認し、既存コードのバックアップと比較を行って反映した。正本は `sheet-api.gs` 末尾の `// Completion-only reminder state` 以降。反映用の抜き出しは `_preview/reminder-sync.gs`。
3. 「デプロイ」→「デプロイを管理」で、既存のウェブアプリを新しいバージョンへ更新する。URL、実行ユーザー、アクセス設定は変更しない。確認時点ではバージョン24だった。
4. 既存の認証で `reminderState` の get/set を検証する。名前や実在する予定をテスト送信しない。トークンを画面・ログ・リポジトリへ出さない。
5. `npm test` と `npm run test:browser` を必要に応じて再確認し、`node build.js --reuse-data --today <今日> --master _assets/list.html --out _deploy/comlist.html` で生成する。
6. `tools/publish_bundle.js` で公開用チェックアウトへ転記し、対象差分だけをmainへcommit/pushする。公開HTML・manifest・全参照ファイルの一致とルート404を検証する。

Apps Script はバージョン25へ更新済み。本番APIの get/set/get と既存 taskState が成功した。フロントの公開は通常のビルド・転記・commit・push・公開検証で行う。

## GASを更新するときの注意

`sheet-api.gs` 全体を正本として差し替える場合、別の `ReminderSync.gs` を重ねて置かない。doPostラッパーの重複を避ける。既存コードを残す場合は、末尾の同期API部分だけを独立ファイルへ1回追加する。

完了記録は日次タスクの14日保存期限とは別に保持する。バケットの保存上限に達した場合は失敗を返し、記録を黙って削除しない。

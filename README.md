# broamp

Winamp 風のターミナル UI を Chrome の小さなプレイヤーウィンドウに載せたミュージックプレイヤーです。ラジオ、プレイリスト、10-band EQ、ビジュアライザ、スリープタイマーをブラウザだけで使えます。

Spotify / Tidal などの OAuth 配信は含みません。ラジオ・ローカルファイル・任意 URL に絞っています。

## デモ（開発サーバ）

```sh
npm start
```

ブラウザで `http://127.0.0.1:43187` を開きます。ルートはプレイヤー、`/index.html` はインストール手順です。

## Chrome 拡張として読み込む

1. `chrome://extensions` を開く
2. デベロッパーモードをオン
3. **パッケージ化されていない拡張機能を読み込む**
4. このフォルダを選択
5. ツールバーの broamp アイコンをクリック（小さな操作ウィンドウが開きます）

同じアイコンをもう一度押すと、既存のウィンドウにフォーカスします。右クリックからタブ / サイドパネルも開けます。音声は offscreen document で再生されるので、ウィンドウを閉じても続きから聴けます。

## できること

- おすすめ 12 局（SomaFM / Nightride など）の即再生
- `R` で Radio Browser 検索、`N` で国別
- `u` でストリーム / M3U / PLS URL
- `o` でローカル音声ファイル
- 10-band EQ（Rock, Pop, Jazz などのプリセット）
- ビジュアライザ: spectrum / mirror / waveform / scope / particles / heartbeat
- 21 テーマ（hackerman, winamp, tokyo-night, catppuccin…）
- お気に入り・再生履歴・lrclib 歌詞
- スリープタイマー（60 / 55 / 30 / 25 / 10 / 5 / 3 / 1 分）。終了で自動停止、残り 1 分からフェードアウトし、女性の声で「OK」と知らせます
- キーボード操作（`?` で一覧）

## キー（抜粋）

| キー | 動作 |
| --- | --- |
| `Space` | 再生 / 一時停止 |
| `Enter` | カーソル位置を再生 |
| `j` `k` | プレイリスト移動 / EQ ゲイン |
| `e` | EQ プリセット |
| `t` / `v` | テーマ / ビジュアライザ |
| `z` / `r` | シャッフル / リピート |
| `R` | ラジオ検索 |
| `f` | お気に入り |
| `?` | キーマップ |

## 構成

```
manifest.json     Chrome MV3
background.js     サイドパネル / offscreen / メディアキー
offscreen.html    バックグラウンド再生
player.html       TUI
js/               エンジン・ラジオ・UI
```

## ライセンス

MIT.

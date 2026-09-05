# cliamp for Chrome

[cliamp](https://www.cliamp.stream/#install) に着想を得た、Chrome 拡張のターミナル風ミュージックプレイヤーです。Winamp のような 10-band EQ、ビジュアライザ、プレイリスト、Radio Browser（3万局超）をサイドパネルに載せます。

Spotify / Tidal などの OAuth 配信は含みません。ブラウザで完結するラジオ・ローカルファイル・任意 URL に絞っています。

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
5. ツールバーの cliamp アイコンをクリック（サイドパネル）

アイコンを右クリックすると、独立ウィンドウまたはタブでも開けます。音声は offscreen document で再生されるので、パネルを閉じても続きから聴けます。

## できること

- おすすめ 12 局（SomaFM / Nightride など）の即再生
- `R` で Radio Browser 検索、`N` で国別
- `u` でストリーム / M3U / PLS URL
- `o` でローカル音声ファイル
- 10-band EQ（cliamp と同じプリセット: Rock, Pop, Jazz…）
- ビジュアライザ: spectrum / mirror / waveform / scope / particles / heartbeat
- 21 テーマ（hackerman, winamp, tokyo-night, catppuccin…）
- お気に入り・再生履歴・lrclib 歌詞
- cliamp に寄せたキーバインド（`?` で一覧）

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

MIT。オリジナルの [cliamp](https://github.com/bjarneo/cliamp) も MIT です。本プロジェクトは非公式のブラウザ移植です。

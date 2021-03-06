# lichessbot

Implements the [lichess bot API](https://lichess.org/api#tag/Chess-Bot). Works both in Node.js and in the browser. In the latter case you need to bundle the code using [browserify](http://browserify.org/) .

## Synopsis

```javascript
const { LichessBot } = require('@aestheticbookshelf/lichessbot')

const USER = {
  id: "", // lichess user id
  accessToken: "" // access token with scopes read challenge / accept challenge / play as bot
}

if(USER.id){
    let b = LichessBot({
        userId: USER.id,
        token: USER.accessToken,
        stockfishPath: "", // path/to/stockfish.wasm.js
        acceptVariant: "standard", // space separated list of variant keys
        minInitialClock: 15 // minimum initial clock in seconds
    })

    console.log(b)

    b.stream()
}
```

## Engine

Constructor uses `stockfishPath` to configure the engine, which in the browser should point to `stockfish.wasm.js` ( you should also provide `stockfish.wasm` in the same folder, see also [multi variant Stockfish wasm releases](https://github.com/niklasf/stockfish.js/releases) ), in Node.js to the native Stockfish executable ( see also [multi variant Stockfish releases](https://github.com/ddugovic/Stockfish/releases) ).

While Stockfish is the recommended choice ( supporting all lichess variants and having both webassembly and native executables ), you can use any UCI engine. For the brower you have to create a UCI engine that can oparate as a web worker, taking commands and reporting output as web worker messages.
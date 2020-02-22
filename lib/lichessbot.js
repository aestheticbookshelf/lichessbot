const spawn = require('child_process').spawn

const utils = require('@nodechessengineserver/miscutils')
const lichess = require('@nodechessengineserver/lichess')
const chessboard = require('@nodechessengineserver/chessboard')

const IS_BROWSER = ( typeof window != "undefined" )

const DEFAULT_REDUCE_THINKING_TIME      = 1

class ServerEngine_ extends chessboard.AbstractEngine{
    constructor(sendanalysisinfo, stockfishPath){
        super(sendanalysisinfo, stockfishPath)    
    }

    processstdout(data){
        data = data.replace(/\r/g, "")  

        for(let line of data.split("\n")){
            this.processstdoutline(line)
        }
    }

    spawnengineprocess(){
        this.process = spawn(this.stockfishPath)

        this.process.stdout.on('data', (data) => {
            this.processstdout(`${data}`)
        })

        this.process.stderr.on('data', (data) => {
            this.processstdout(`${data}`)
        })
    }

    terminate(){
        this.process.kill()
    }

    sendcommandtoengine(command){        
        this.process.stdin.write(command + "\n")     
    }
}
function ServerEngine(sendanalysisinfo, stockfishPath){return new ServerEngine_(sendanalysisinfo, stockfishPath)}

class LocalEngine_ extends chessboard.AbstractEngine{
    constructor(sendanalysisinfo, stockfishPath){
        super(sendanalysisinfo, stockfishPath)    
    }

    spawnengineprocess(){
        this.stockfish = new Worker(this.stockfishPath)

        this.stockfish.onmessage = message => {
            this.processstdoutline(message.data)
        }
    }

    sendcommandtoengine(command){
        this.stockfish.postMessage(command)
    }

    terminate(){
        this.stockfish.terminate()
    }
}
function LocalEngine(sendanalysisinfo, stockfishPath){return new LocalEngine_(sendanalysisinfo, stockfishPath)}

class LichessBotGame_{
    poweredBy(){
        this.writeBotChat(["player", "spectator"], `${this.botName} powered by https://easychess.herokuapp.com .`)
    }

    constructor(props){
        this.props = props

        this.parentBot = props.parentBot
        
        this.id = props.id        

        this.engine = IS_BROWSER ?
            LocalEngine(() => {}, this.parentBot.props.stockfishPath)
        :
            ServerEngine(() => {}, this.parentBot.props.stockfishPath)

        this.ratingDiff = 0

        this.gameStateReader = new utils.NdjsonReader(lichess.LICHESS_STREAM_GAME_STATE_URL + "/" + this.id, this.processGameEvent.bind(this), this.parentBot.token, this.processTermination.bind(this))

        this.gameStateReader.stream()
    }

    writeBotChat(rooms, msg){
        return
        for(let room of rooms){
            lichess.writeLichessBotChat(this.id, room, msg, this.parentBot.token).then(result => {
                //
            })
        }
    }

    processGameEvent(event){
        if(event.type == "chatLine") return

        console.log(JSON.stringify(event, null, 2))

        if(event.type == "gameFull"){
            let gameFull = event
            this.gameFull = gameFull

            this.botTurn = chessboard.WHITE

            this.botRating = gameFull.white.rating || 1500
            this.oppRating = gameFull.black.rating || 1500

            this.botName = gameFull.white.name
            this.opponentName = gameFull.black.name

            if(gameFull.black.id == this.parentBot.userId){
                this.botTurn = chessboard.BLACK

                this.botRating = gameFull.black.rating || 1500
                this.oppRating = gameFull.white.rating || 1500

                this.botName = gameFull.black.name
                this.opponentName = gameFull.white.name
            }

            this.ratingDiff = this.oppRating - this.botRating

            this.variant = gameFull.variant.key

            this.testBoard = chessboard.ChessBoard().setfromfen(
                gameFull.initialFen == "startpos" ? null : gameFull.initialFen,
                this.variant
            )

            this.initialFen = this.testBoard.fen

            this.state = gameFull.state

            this.writeBotChat(["player", "spectator"], `Good luck, ${this.opponentName} !`)                
            
            this.poweredBy()
        }else if(event.type == "gameState"){
            this.state = event
        }

        if(this.gameFull && this.state){
            this.board = chessboard.ChessBoard().setfromfen(
                this.initialFen,
                this.variant
            )

            let allMovesOk = true

            this.moves = null

            if(this.state.moves){
                this.moves = this.state.moves.split(" ")
                for(let algeb of this.moves){
                    allMovesOk = allMovesOk && this.board.pushalgeb(algeb)
                }
            }                

            this.currentFen = this.board.fen

            console.log("allMovesOk", allMovesOk, this.board.toString())

            if(allMovesOk){
                if(this.board.turn == this.botTurn){
                    let lms = this.board.legalmovesforallpieces()

                    if(lms.length){
                        let reduceThinkingTime = this.parentBot.props.reduceThinkingTime || DEFAULT_REDUCE_THINKING_TIME

                        this.timecontrol = {
                            wtime:  this.state.wtime ? Math.floor(this.state.wtime / reduceThinkingTime) : 10000,
                            winc:   this.state.winc  || 0,
                            btime:  this.state.btime ? Math.floor(this.state.btime / reduceThinkingTime) : 10000,
                            binc:   this.state.binc  || 0,
                        }

                        if(this.timecontrol.wtime > utils.HOUR) this.timecontrol.wtime = 10000
                        if(this.timecontrol.btime > utils.HOUR) this.timecontrol.btime = 10000                            

                        if(this.parentBot.props.makeRandomMoves){
                            let selmove = lms[Math.floor(Math.random() * lms.length)]
                            let algeb = this.board.movetoalgeb(selmove)
                            this.playBotMove("random", {bestmove: algeb, scorenumerical: null})
                        }else{
                            let bookalgeb = null

                            if(this.parentBot.props.useOwnBook){
                                let weightIndices = this.parentBot.props.allowOpponentWeightsInBotBook ? [0, 1] : [0]
                                bookalgeb = this.parentBot.props.bookGame ? this.parentBot.props.bookGame.weightedAlgebForFen(currentFen, weightIndices) : null
                            }

                            ((
                                this.parentBot.props.useBotBook ||
                                ( this.parentBot.props.allowFallBackToBotBook && (!bookalgeb) )
                            ) ?
                                (lichess.requestLichessBook(
                                this.currentFen,
                                this.variant,
                                this.parentBot.props.lichessBookMaxMoves || lichess.LICHESS_BOOK_MAX_MOVES,
                                (this.parentBot.props.lichessBookAvgRatings || lichess.LICHESS_BOOK_AVG_RATINGS),
                                (this.parentBot.props.lichessBookTimeControls || lichess.LICHESS_BOOK_TIME_CONTROLS)
                            )) : utils.RP({moves: null})).then(result => {
                                let bmoves = result.moves

                                if(bmoves && bmoves.length){
                                    let grandTotal = 0

                                    for(let bmove of bmoves){
                                        bmove.total = bmove.white + bmove.draws + bmove.black
                                        grandTotal += bmove.total
                                    }

                                    let rand = Math.round(Math.random() * grandTotal)

                                    let currentTotal = 0

                                    for(let bmove of bmoves){
                                        currentTotal += bmove.total                                            
                                        if(currentTotal >= rand){
                                            bookalgeb = bmove.uci
                                            break
                                        }                                            
                                    }
                                }

                                if(bookalgeb){
                                    this.playBotMove("book", {bestmove: bookalgeb, scorenumerical: null})
                                }
                                else{
                                    this.moveOverHead = parseInt(this.parentBot.props.moveOverHead || chessboard.DEFAULT_MOVE_OVERHEAD)
                                    this.engine.play(this.initialFen, this.moves, this.variant, this.timecontrol, this.moveOverHead).then(
                                        this.playBotMove.bind(this, "engine")
                                    )
                                }
                            })                                
                        }                            
                    }
                }
            }
        }
    }

    playBotMove(method, moveObj){
        let move = this.board.algebtomove(moveObj.bestmove)

        let offeringDraw = false

        if(move){
            let msg = `My ${method} move : ${this.board.movetosan(move)} .`

            let randPercent = Math.round(Math.random() * 100)

            if(!(moveObj.scorenumerical === null)){
                let scorenumerical = moveObj.scorenumerical
                msg += ` Score numerical cp : ${scorenumerical} .`                
                if(this.moves && this.moves.length > 40){
                    if(ratingDiff > -200){
                        if(scorenumerical == 0){
                            offeringDraw = true
                        }
                        if(scorenumerical < 200){
                            if(randPercent < 10) offeringDraw = true
                        }
                    }
                }
            }

            if(offeringDraw) msg += " I would agree to a draw ."            

            lichess.makeLichessBotMove(this.id, moveObj.bestmove, offeringDraw, this.parentBot.token).then(result => {
                //
            })

            this.writeBotChat(["player", "spectator"], msg)
        }else{
            // try to make move anyway
            lichess.makeLichessBotMove(this.id, moveObj.bestmove, offeringDraw, this.parentBot.token).then(result => {
                //
            })
        }
    }

    processTermination(){
        console.log(`Game ${this.id} terminated .`)

        this.writeBotChat(["player", "spectator"], `Good game, ${this.opponentName} !`)
        this.poweredBy()
        this.engine.terminate()
    }
}
function LichessBotGame(props){return new LichessBotGame_(props)}

class LichessBot_{
    constructor(props){
        this.props = props

        this.token = props.token

        this.userId = props.userId

        this.acceptVariant = props.acceptVariant

        if(props.acceptVariant){
            if(typeof props.acceptVariant == "string") this.acceptVariant = props.acceptVariant.split(" ")
        }

        this.minInitialClock = props.minInitialClock || 60
    }

    toString(){
        return `bot ${this.token}`
    }

    challengeRefused(msg){
        console.log("Challenge refused .", msg)
    }

    processBotEvent(event){
        console.log(JSON.stringify(event, null, 2))

        if(event.type == "challenge"){
            let challenge = event.challenge

            if(this.acceptVariant){
                if(!this.acceptVariant.includes(challenge.variant.key)){
                    return this.challengeRefused(`Wrong variant . Acceptable variant(s) : ${this.acceptVariant.join(" , ")} .`)            
                }
            }

            if(challenge.timeControl.limit < this.minInitialClock){
                return this.challengeRefused(`Initial clock too low . Minimum initial clock : ${this.minInitialClock} sec(s) .`)            
            }

            lichess.acceptLichessChallenge(event.challenge.id, this.token)
        }else if(event.type == "gameStart"){
            LichessBotGame({
                parentBot: this,
                id: event.game.id
            })
        }
    }

    stream(){
        this.challengeReader = new utils.NdjsonReader(lichess.LICHESS_STREAM_EVENTS_URL, this.processBotEvent.bind(this), this.token)

        this.challengeReader.stream()
    }
}
function LichessBot(props){return new LichessBot_(props)}

module.exports = {
    LichessBot: LichessBot
}

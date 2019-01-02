const robin = require('roundrobin');

module.exports = class Tournament
{
	constructor(socketClients, tournamentRegistry) {
        this.socketClients = socketClients;
        this.movesTimeoutsCheckingTimer = null;
        this.boards = [];
        this._ = tournamentRegistry;
	}
    addPlayer(playerName) {
        let player = this._._.players.find(player => player.name === playerName);
        if (typeof player === 'undefined') {
            let playerIdx = this._._.players.length;
            this._._.players[playerIdx] = {
                idx: playerIdx,
                name: playerName
            };
            return playerIdx;
        }   
        return player.idx;
    }
    startUncompletedRound() {
        // checks if the last round is finished
        let round = this._._.rounds.find(round => round.finishedAt === null);
        if (typeof round !== 'undefined') {
            return;
        }
        // saves the current data before every round
        this._.save();
        // marks a tournament as started
        if (this._._.isStarted === false) {
            // start moves timeouts checking timer
            this.movesTimeoutsCheckingTimer = setInterval(this.startMovesTimeoutsChecking, 200);
        }
        this._._.isStarted = true;
        // now, starts the current round
        const roundIdx = this._._.rounds.length;
        this._._.rounds[roundIdx] =  {
            idx: roundIdx,
			startedAt: + new Date(),
			finishedAt: null,
			matches: []
		};
        // creates the pairing for the current round
        let pairing = [];
		if (this._._.options.system === 'round-robin') {
			const roundRobinRounds = robin(this._._.players.length, Object.keys(this._._.players));
			if (roundIdx < roundRobinRounds.length) {
				pairing = roundRobinRounds[roundIdx];
			}
		}
        // @todo: add the swiss tournament system
        // creates matches and games
        for (let competitors of pairing) {
            let matchIdx = this._._.matches.length;
            this._._.matches[matchIdx] = {
                idx: matchIdx,
                roundIdx: roundIdx, // reduces searching
				players: competitors,
				startedAt: null,
				finishedAt: null,
				games: []
			};
			for (let i = 0; i < this._._.options.nofGames; ++i) {
                let gameIdx = this._._.games.length;
				this._._.games[gameIdx] = {
                    idx: gameIdx,
                    matchIdx: matchIdx, // reduces searching
                    roundIdx: roundIdx, // reduces searching
					white: i < this._._.options.nofGames / 2 ? competitors[0] : competitors[1],
					black: i < this._._.options.nofGames / 2 ? competitors[1] : competitors[2],
					winner: null,
					loser: null,
					wonBy: null,
					startedAt: null,
					finishedAt: null,
                    playerOnMove: null,
                    moveTimeout: null,
                    initialBoard: null,
                    currentBoard: null,
                    moves: []
				};
				this._._.matches[matchIdx].games.push(gameIdx);
			}
			this._._.rounds[roundIdx].matches.push(matchIdx);
		}
        this.startUncompletedMatches();
    }
    startUncompletedMatches() {
        let nofStartedMatches = 0;
		let usedIPAddresses = []; // holds IP addresses that can't be used
        // firstly, handles all running games
        this._._.matches.filter(match => match.startedAt !== null && match.finishedAt === null).forEach(match => {
            // checks IP addresses from running matches
            match.players.forEach(playerIdx => {
                let socketClient = this.socketClients.find(socketClient => socketClient.playerIdx === playerIdx);
                if(typeof socketClient !== 'undefined') {
                    usedIPAddresses.push(socketClient.remoteAddress);
                }
            });
            nofStartedMatches++;
        });
        // secondly, handles upcoming games that can be started
        this._._.matches.filter(match => match.startedAt === null).forEach(match => {
            let addresses = [];
            // checks IP addresses from upcoming matches
            match.players.forEach(playerIdx => {
                let socketClient = this.socketClients.find(socketClient => socketClient.playerIdx === playerIdx);
                if(typeof socketClient !== 'undefined') {
                    addresses.push(socketClient.remoteAddress);
                }
            });
            if (addresses.every(address => usedIPAddresses.indexOf(address) === -1)) {
                match.startedAt = + new Date();
                addresses.forEach(address => usedIPAddresses.push(address));
                nofStartedMatches++;
            }
        });
        // finally, if there is no running matches, finishes the current round
        if (nofStartedMatches === 0) {
            let round = this._._.rounds.find(round => round.finishedAt === null);
            round.finishedAt + new Date();
        } else {
            this.startUncompletedGames(); // starts matches' games
        }
    }
    startUncompletedGames() {
        // filters out upcoming and finished matches
        this._._.matches.filter(match => match.startedAt !== null && match.finishedAt === null).forEach(match => {
            let hasUnfinishedGame = false;
            for (let gameIdx of match.games) {
                if (this._._.games[gameIdx].startedAt === null) {
					this._._.games[gameIdx].startedAt = + new Date(); // starts the game
                    // finds corresponding socket clients
                    const whiteSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === this._._.games[gameIdx].white);
                    const blackSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === this._._.games[gameIdx].black);
					// both players are disconnected
                    if (whiteSocketClient === undefined && blackSocketClient === undefined) {
						this._._.games[gameIdx].finishedAt = + new Date();
						this._._.games[gameIdx].wonBy = 'Brak połączenia obu graczy';
					} else if (whiteSocketClient === undefined) { // white player is disconnected
                        this._._.games[gameIdx].finishedAt = + new Date();
                        this._._.games[gameIdx].winner = 'black';
                        this._._.games[gameIdx].loser = 'white';
                        this._._.games[gameIdx].wonBy = 'Brak połączenia przeciwnika';
						blackSocketClient.write('232');
					} else if (blackSocketClient === undefined) { // black player is disconnected
						this._._.games[gameIdx].finishedAt = + new Date();
						this._._.games[gameIdx].winner = 'white';
						this._._.games[gameIdx].loser = 'black';
						this._._.games[gameIdx].wonBy = 'Brak połączenia przeciwnika';
						whiteSocketClient.write('232');
					} else {
                        this._._.games[gameIdx].playerOnMove = 'white';
                        this._._.games[gameIdx].moveTimeout = (+ new Date()) + this._._.options.timeLimit;
                        // creates the board
                        this.boards[gameIdx] = new AmazonsGameBoard(this.settings.initialBoard);
                        this._._.games[gameIdx].initialBoard = this.settings.initialBoard;
                        this._._.games[gameIdx].currentBoard = this.boards[gameIdx].state.toString();
						hasUnfinishedGame = true;
						break; // starts only one game
					}
				}
            }
            // if there is no started games then finishes the match
            if (hasUnfinishedGame === false) {
                match.finishedAt = + new Date();
				this.startUncompletedMatches();
            }
        });
    }
    startMovesTimeoutsChecking() {
        this._._.games.filter(game => game.startedAt !== null && game.finishedAt === null).forEach(game => {
            const currentTimestamp = + new Date();
            // checks if the move timeout is expired
            if (game.moveTimeout < currentTimestamp) {
                const winner = game.playerOnMove === 'white' ? 'black' : 'white';
                const loser = game.playerOnMove;
                // since JS is single-threaded hence the socket clients should be available
                const winnerSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[winner]);
                const loserSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[loser]);
                game.finishedAt = + new Date();
                game.winner = winner;
                game.loser = loser;
                game.wonBy = 'Przekroczenie czasu na ruch przeciwnika';
                winnerSocketClient.write(231);
                loserSocketClient.write(241);
                // because the game is finished, checks other unfinished games
                this.startUncompletedGames();
            }
        });
    }
    applyMove(playerIdx, move) {
        const game = this._._.games.find(
            game => (game.white === playerIdx || game.black === playerIdx)
            && game.startedAt !== null && game.finishedAt === null
        );
        // check if the game exists
        if (typeof game !== 'undefined') {
            try {
                // check is the player's turn
                if (game[game.playerOnMove] !== playerIdx) {
                    throw [3, playerIdx];
                }
                // try to make a move
                this.boards[game.idx].makeMove(move[0], move[1], move[2]);
                // the move is correct hence update the game data
                game.playerOnMove = game.playerOnMove === 'white' ? 'black' : 'white';
                game.currentBoard = this.boards[game.idx].state.toString();
                game.moves.push(move);
                // the player should be available
                const socketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[game.playerOnMove]);
                socketClient.write('220 ' + move[0] + ' ' + move[1] + ' ' + move[2]);
            } catch (e) {
                if (e[0] === 1) { // no moves for the next player
                    const winner = game.playerOnMove;
                    const loser = game.playerOnMove === 'white' ? 'black' : 'white';
                    game.wonBy = 'Wygrana zgodnie z zasadami';
                } else if (e[0] === 2) { // an invalid move has been played
                    const winner = game.playerOnMove === 'white' ? 'black' : 'white';
                    const loser = game.playerOnMove;
                    game.wonBy = 'Wygrana zgodnie z zasadami (niepoprawny ruch)';
                } else if (e[0] === 3) { // the player has played on the opponent's turn
                    const winner = game.playerOnMove === 'white' ? 'black' : 'white';
                    const loser = game.playerOnMove;
                    game.wonBy = 'Wygrana zgodnie z zasadami (zagranie nie w swojej turze)';
                }
                // finishes the game and starts upcoming games
                const winnerSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[winner]);
                const loserSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[loser]);
                game.finishedAt = + new Date();
                game.winner = winner;
                game.loser = loser;
                winnerSocketClient.write(230);
                loserSocketClient.write(240);
                this.startUncompletedGames();
            }
        }
    }
    /**
     * Handles a player disconnecting
     */
    disconnect(playerIdx) {
        const game = this._._.games.find(
            game => (game.white === playerIdx || game.black === playerIdx)
            && game.startedAt !== null && game.finishedAt === null
        );
        if (typeof game !== 'undefined') {
            const winner = game.white === playerIdx ? 'black' : 'white';
            const loser = game.white === playerIdx ? 'white' : 'black';
            // the socket client should be available
            const winnerSocketClient = this.socketClients.find(socketClient => socketClient.playerIdx === game[winner]);
            game.finishedAt = + new Date();
            game.winner = winner;
            game.loser = loser;
            game.wonBy = 'Wygrana przez rozłączenie się przeciwnika';
            winnerSocketClient.write(232);
            this.startUncompletedGames();
        }
    }
}
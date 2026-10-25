(() => {
  "use strict";

  const OWNER = "jschmierer";
  const API = "https://api.github.com";
  const RAW = "https://raw.githubusercontent.com";
  const TEXT_EXTENSIONS = new Set([
    ".py", ".in", ".txt", ".md", ".json", ".csv", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".js", ".html", ".css", ".scss", ".sh"
  ]);

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".project-page").forEach(initProjectPage);
  });

  async function initProjectPage(root) {
    const repo = root.dataset.repo;
    const project = root.dataset.project;
    const mode = root.dataset.mode;
    const entryName = root.dataset.entry || "";
    const codeWindow = root.querySelector(".code-window");
    const fileList = root.querySelector("[data-file-list]");
    const codeOutput = root.querySelector("[data-source-code]");
    const activeFileLabel = root.querySelector("[data-active-file]");
    const openFileLink = root.querySelector("[data-open-file]");
    const terminal = root.querySelector("[data-terminal-output]");
    const turtleStage = root.querySelector("[data-turtle-stage]");
    const controls = root.querySelector("[data-terminal-controls]");
    const status = root.querySelector("[data-preview-status]");
    const previewHeading = root.querySelector("[data-preview-heading]");
    const footnote = root.querySelector("[data-preview-footnote]");
    const runButton = root.querySelector("[data-run-project]");
    const resetButton = root.querySelector("[data-reset-project]");
    const clearButton = root.querySelector("[data-clear-terminal]");
    const sourceCache = new Map();
    let files = [];
    let activePath = "";

    function setStatus(message) {
      if (status) status.textContent = message;
    }
    function appendTerminal(text) {
      terminal.hidden = false;
      terminal.textContent += String(text);
      terminal.scrollTop = terminal.scrollHeight;
    }
    function replaceTerminal(text) {
      terminal.hidden = false;
      terminal.textContent = String(text);
      terminal.scrollTop = terminal.scrollHeight;
    }
    function makeButton(label, action, options = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `console-control${options.primary ? " primary" : ""}`;
      button.textContent = label;
      if (options.disabled) button.disabled = true;
      button.addEventListener("click", action);
      return button;
    }
    function shortName(path) {
      return path.split("/").pop() || path;
    }
    function extension(path) {
      const name = shortName(path);
      const dot = name.lastIndexOf(".");
      return dot >= 0 ? name.slice(dot).toLowerCase() : "";
    }
    function rawUrl(path, branch) {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      return `${RAW}/${OWNER}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
    }
    function githubBlobUrl(path, branch) {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      return `https://github.com/${OWNER}/${repo}/blob/${encodeURIComponent(branch)}/${encodedPath}`;
    }
    async function fetchText(path, branch) {
      if (sourceCache.has(path)) return sourceCache.get(path);
      const pending = (async () => {
        const response = await fetch(rawUrl(path, branch));
        if (!response.ok) throw new Error(`GitHub file request failed (${response.status})`);
        return response.text();
      })();
      sourceCache.set(path, pending);
      try {
        const result = await pending;
        sourceCache.set(path, result);
        return result;
      } catch (error) {
        sourceCache.delete(path);
        throw error;
      }
    }
    function setLanguage(path) {
      const ext = extension(path);
      const languages = {
        ".py": "python", ".js": "javascript", ".html": "xml", ".css": "css",
        ".scss": "scss", ".json": "json", ".sh": "bash", ".md": "markdown",
        ".yaml": "yaml", ".yml": "yaml", ".toml": "ini", ".ini": "ini", ".cfg": "ini"
      };
      return languages[ext] || "plaintext";
    }
    async function showSource(path) {
      activePath = path;
      activeFileLabel.textContent = shortName(path);
      activeFileLabel.title = path;
      openFileLink.href = githubBlobUrl(path, branchName);
      [...fileList.querySelectorAll(".file-button")].forEach((button) => {
        const isActive = button.dataset.path === path;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-current", isActive ? "true" : "false");
      });
      codeOutput.textContent = "Loading source…";
      codeOutput.className = `language-${setLanguage(path)}`;
      try {
        const source = await fetchText(path, branchName);
        codeOutput.textContent = source;
        if (window.hljs) {
          try { window.hljs.highlightElement(codeOutput); } catch (_) { /* Plain source is still readable. */ }
        }
      } catch (error) {
        codeOutput.textContent = `# Couldn't load this file automatically.\n# Check your connection, then try selecting it again.\n# You can still open it on GitHub: ${githubBlobUrl(path, branchName)}\n\n# Loading error: ${error.message}`;
        setStatus("Source load failed");
      }
    }
    function buildFileList() {
      fileList.replaceChildren();
      if (!files.length) {
        fileList.innerHTML = '<div class="viewer-message">No displayable source files were found.</div>';
        return;
      }
      files.forEach((file) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-button";
        button.dataset.path = file.path;
        button.textContent = shortName(file.path);
        button.title = file.path;
        button.addEventListener("click", () => showSource(file.path));
        fileList.appendChild(button);
      });
    }

    root.querySelector("[data-collapse-files]")?.addEventListener("click", () => {
      codeWindow.classList.add("files-collapsed");
    });
    root.querySelector("[data-show-files]")?.addEventListener("click", () => {
      codeWindow.classList.remove("files-collapsed");
    });

    let branchName = "main";
    try {
      setStatus("Connecting to GitHub…");
      const metaResponse = await fetch(`${API}/repos/${OWNER}/${repo}`);
      if (!metaResponse.ok) throw new Error(`GitHub repository request failed (${metaResponse.status})`);
      const metadata = await metaResponse.json();
      branchName = metadata.default_branch || "main";
      const treeResponse = await fetch(`${API}/repos/${OWNER}/${repo}/git/trees/${encodeURIComponent(branchName)}?recursive=1`);
      if (!treeResponse.ok) throw new Error(`GitHub file list request failed (${treeResponse.status})`);
      const treeData = await treeResponse.json();
      files = (treeData.tree || [])
        .filter((item) => item.type === "blob" && TEXT_EXTENSIONS.has(extension(item.path)))
        .filter((item) => !/(^|\/)(\.git|\.venv|venv|node_modules|__pycache__|dist|build)(\/|$)/i.test(item.path))
        .filter((item) => !item.size || item.size <= 400000)
        .map((item) => ({ path: item.path, size: item.size || 0 }))
        .sort((a, b) => {
          const rank = (path) => {
            const ext = extension(path);
            if (ext === ".py") return 0;
            if (ext === ".in") return 1;
            if (ext === ".txt") return 2;
            if (shortName(path).toLowerCase() === "readme.md") return 4;
            return 3;
          };
          return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
        });
      buildFileList();
      const preferred = files.find((file) => file.path === entryName)
        || files.find((file) => file.path.endsWith(`/${entryName}`))
        || files.find((file) => extension(file.path) === ".py")
        || files[0];
      if (preferred) await showSource(preferred.path);
      setStatus("Files loaded");
    } catch (error) {
      fileList.innerHTML = '<div class="viewer-message">Could not load the GitHub file list.<br><br>Try reloading this page, or open the repository using the link above.</div>';
      codeOutput.textContent = `# GitHub source loading failed.\n# The code panel is ready to display source once access is restored.\n# Repository: https://github.com/${OWNER}/${repo}\n\n# Error: ${error.message}`;
      activeFileLabel.textContent = "Source unavailable";
      setStatus("GitHub unavailable");
    }

    function entryFile() {
      return files.find((file) => file.path === entryName)
        || files.find((file) => file.path.endsWith(`/${entryName}`))
        || files.find((file) => extension(file.path) === ".py");
    }

    // The turtle previews run the selected repo's Python file through Skulpt.
    async function runTurtleProject() {
      const entry = entryFile();
      if (!entry) {
        appendTerminal("No Python file was found in this repository.\n");
        return;
      }
      if (!window.Sk || !window.Sk.misceval) {
        appendTerminal("The in-browser Python runtime didn't load. Check the network connection and reload.\n");
        setStatus("Python runtime unavailable");
        return;
      }
      const source = await fetchText(entry.path, branchName);
      terminal.textContent = "";
      terminal.hidden = false;
      turtleStage.hidden = false;
      turtleStage.replaceChildren();
      controls.replaceChildren();
      runButton.disabled = true;
      setStatus(`Running ${shortName(entry.path)}…`);
      const builtinRead = (path) => {
        const builtin = window.Sk.builtinFiles && window.Sk.builtinFiles.files[path];
        if (builtin === undefined) throw new Error(`Python runtime file not found: '${path}'`);
        return builtin;
      };
      window.Sk.execLimit = 40000;
      window.Sk.inputfunTakesPrompt = true;
      window.Sk.configure({
        output: (text) => appendTerminal(text),
        read: builtinRead,
        __future__: window.Sk.python3,
        inputfun: (prompt) => new Promise((resolve) => {
          controls.replaceChildren();
          const form = document.createElement("form");
          form.className = "console-input-wrap";
          const promptLabel = document.createElement("span");
          promptLabel.textContent = prompt || ">";
          const input = document.createElement("input");
          input.type = "text";
          input.autocomplete = "off";
          input.setAttribute("aria-label", prompt || "Python input");
          const send = document.createElement("button");
          send.type = "submit";
          send.className = "console-control primary";
          send.textContent = "Enter";
          form.append(promptLabel, input, send);
          controls.appendChild(form);
          input.focus();
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            const value = input.value;
            appendTerminal(`${value}\n`);
            controls.replaceChildren();
            resolve(value);
          }, { once: true });
        })
      });
      window.Sk.TurtleGraphics = window.Sk.TurtleGraphics || {};
      window.Sk.TurtleGraphics.target = turtleStage.id;
      try {
        await window.Sk.misceval.asyncToPromise(() => window.Sk.importMainWithBody("<stdin>", false, source, true));
        setStatus("Program finished");
      } catch (error) {
        appendTerminal(`\n[Preview error] ${error && error.toString ? error.toString() : String(error)}\n\nThis browser runtime supports basic Python and Turtle, not every desktop Python feature. The complete source remains available in the code panel.\n`);
        setStatus("Preview stopped");
      } finally {
        runButton.disabled = false;
      }
    }

    function setupTurtlePreview() {
      previewHeading.textContent = "Turtle window";
      runButton.hidden = false;
      resetButton.hidden = false;
      clearButton.hidden = false;
      turtleStage.hidden = false;
      terminal.hidden = false;
      replaceTerminal("Turtle preview ready. Click Run Python to launch the project in this browser window.\n\nTip: this is a browser-based Python interpreter, so features that depend on desktop-only APIs may not work exactly like they do on your computer.");
      footnote.textContent = "Python/Turtle runs in the browser. If a desktop-only feature fails, use the GitHub link to run the original locally.";
      runButton.addEventListener("click", () => {
        runTurtleProject().catch((error) => {
          appendTerminal(`\n[Preview error] ${error.message}\n`);
          setStatus("Could not run");
          runButton.disabled = false;
        });
      });
      resetButton.addEventListener("click", () => {
        turtleStage.replaceChildren();
        controls.replaceChildren();
        replaceTerminal("Preview cleared. Click Run Python to start again.");
        setStatus("Ready");
      });
      clearButton.addEventListener("click", () => replaceTerminal(""));
    }

    // Conway's Game of Life: a browser-side version of the terminal grid. The real .in shape
    // files are fetched from the repo and appear in the file selector as well.
    async function setupConwayPreview() {
      previewHeading.textContent = "Terminal · Game of Life";
      terminal.classList.add("conway-output");
      const shapes = files.filter((file) => extension(file.path) === ".in");
      if (!shapes.length) {
        replaceTerminal("No .in shape files were found in the repository.\nOpen the source file on GitHub to inspect the project.");
        return;
      }
      let shapeFile = shapes.find((file) => shortName(file.path).toLowerCase() === "glider.in") || shapes[0];
      let grid = [];
      let generation = 0;
      let timer = null;
      const rows = 30;
      const cols = 40;
      const shapeToolbar = document.createElement("div");
      shapeToolbar.className = "conway-toolbar";
      const shapeLabel = document.createElement("label");
      shapeLabel.textContent = "Pattern";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Choose a Game of Life pattern");
      shapes.forEach((file) => {
        const option = document.createElement("option");
        option.value = file.path;
        option.textContent = shortName(file.path).replace(/\.in$/i, "");
        select.appendChild(option);
      });
      select.value = shapeFile.path;
      const playButton = makeButton("▶ Play", () => togglePlay(), { primary: true });
      const stepButton = makeButton("Step", () => advance());
      const reset = makeButton("Reset", () => loadShape(shapeFile.path));
      shapeToolbar.append(shapeLabel, select, playButton, stepButton, reset);
      controls.replaceChildren(shapeToolbar);

      function blankGrid() { return Array.from({ length: rows }, () => Array(cols).fill(false)); }
      function render() {
        terminal.textContent = `CONWAY'S GAME OF LIFE  |  ${shortName(shapeFile.path)}  |  generation ${generation}\n` + grid.map((row) => row.map((alive) => alive ? "O" : "-").join("")).join("\n");
        terminal.scrollTop = 0;
      }
      function nextGeneration() {
        const next = blankGrid();
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            let neighbors = 0;
            for (let dr = -1; dr <= 1; dr += 1) {
              for (let dc = -1; dc <= 1; dc += 1) {
                if (dr === 0 && dc === 0) continue;
                const rr = r + dr;
                const cc = c + dc;
                if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && grid[rr][cc]) neighbors += 1;
              }
            }
            next[r][c] = grid[r][c] ? neighbors === 2 || neighbors === 3 : neighbors === 3;
          }
        }
        grid = next;
        generation += 1;
        render();
      }
      function stop() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        playButton.textContent = "▶ Play";
      }
      function togglePlay() {
        if (timer !== null) { stop(); return; }
        timer = window.setInterval(nextGeneration, 240);
        playButton.textContent = "Ⅱ Pause";
      }
      function advance() { stop(); nextGeneration(); }
      async function loadShape(path) {
        stop();
        shapeFile = shapes.find((file) => file.path === path) || shapes[0];
        select.value = shapeFile.path;
        setStatus(`Loading ${shortName(shapeFile.path)}…`);
        try {
          const text = await fetchText(shapeFile.path, branchName);
          grid = blankGrid();
          generation = 0;
          text.split(/\r?\n/).forEach((line) => {
            const parts = line.trim().split(/[\s,]+/).map(Number);
            if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
            const r = parts[0];
            const c = parts[1];
            if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = true;
          });
          render();
          setStatus("Simulation ready");
        } catch (error) {
          replaceTerminal(`Couldn't load the pattern ${shortName(shapeFile.path)}.\n${error.message}`);
          setStatus("Pattern load failed");
        }
      }
      select.addEventListener("change", () => loadShape(select.value));
      await loadShape(shapeFile.path);
      footnote.textContent = "The terminal-style preview simulates the Game of Life rules in the browser and uses the repository's .in pattern files.";
    }

    function setupBlackjackPreview() {
      previewHeading.textContent = "Terminal · Blackjack";
      footnote.textContent = "Practice hand only: no wagering or real-money features.";
      const state = { deck: [], player: [], dealer: [], over: true, message: "Choose Deal hand to start." };
      function newDeck() {
        const suits = ["♠", "♥", "♦", "♣"];
        const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
        const deck = [];
        suits.forEach((suit) => ranks.forEach((rank) => deck.push({ rank, suit })));
        for (let i = deck.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
      }
      function score(cards) {
        let total = 0;
        let aces = 0;
        cards.forEach((card) => {
          if (card.rank === "A") { total += 11; aces += 1; }
          else if (["K", "Q", "J"].includes(card.rank)) total += 10;
          else total += Number(card.rank);
        });
        while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
        return total;
      }
      function cardList(cards, hideLast = false) {
        if (!cards.length) return "(no cards dealt)";
        return cards.map((card, index) => hideLast && index === 1 ? "[ ?? ]" : `[ ${card.rank}${card.suit} ]`).join(" ");
      }
      function render() {
        const dealerHidden = !state.over && state.dealer.length > 1;
        const dealerScore = dealerHidden ? "?" : score(state.dealer);
        replaceTerminal([
          "BLACKJACK // PRACTICE HAND",
          "────────────────────────────────────",
          `Dealer: ${cardList(state.dealer, dealerHidden)}    total: ${dealerScore}`,
          `You:    ${cardList(state.player)}    total: ${state.player.length ? score(state.player) : "—"}`,
          "",
          state.message
        ].join("\n"));
        controls.replaceChildren();
        controls.append(
          makeButton("Deal hand", deal, { primary: true, disabled: !state.over }),
          makeButton("Hit", hit, { disabled: state.over }),
          makeButton("Stand", stand, { disabled: state.over })
        );
      }
      function deal() {
        state.deck = newDeck();
        state.player = [state.deck.pop(), state.deck.pop()];
        state.dealer = [state.deck.pop(), state.deck.pop()];
        state.over = false;
        state.message = "Your move: hit or stand.";
        if (score(state.player) === 21) stand(); else render();
      }
      function hit() {
        if (state.over) return;
        state.player.push(state.deck.pop());
        if (score(state.player) > 21) { state.over = true; state.message = "Bust. Dealer wins this hand."; }
        else if (score(state.player) === 21) stand();
        else { state.message = "Your move: hit or stand."; render(); }
      }
      function stand() {
        if (state.over) return;
        while (score(state.dealer) < 17) state.dealer.push(state.deck.pop());
        state.over = true;
        const playerScore = score(state.player);
        const dealerScore = score(state.dealer);
        if (dealerScore > 21 || playerScore > dealerScore) state.message = "You win this hand.";
        else if (playerScore === dealerScore) state.message = "Push: the hand is a tie.";
        else state.message = "Dealer wins this hand.";
        render();
      }
      render();
    }

    async function setupWordlePreview() {
      previewHeading.textContent = "Terminal · Wordle";
      footnote.textContent = "The browser preview reads the repository's possibleWords.txt and validWords.txt word lists.";
      const state = { solution: "CRANE", guesses: [], message: "Type a five-letter guess and press Enter." };
      let validWords = new Set();
      let possibleWords = [];
      const fallbacks = ["CRANE", "SLATE", "REACT", "TRAIL", "AUDIO", "PLANT", "GHOST", "LIGHT", "MOUSE", "BRICK"];
      const possibleFile = files.find((file) => shortName(file.path).toLowerCase() === "possiblewords.txt");
      const validFile = files.find((file) => shortName(file.path).toLowerCase() === "validwords.txt");
      try {
        const [possibleText, validText] = await Promise.all([
          possibleFile ? fetchText(possibleFile.path, branchName) : Promise.resolve(""),
          validFile ? fetchText(validFile.path, branchName) : Promise.resolve("")
        ]);
        possibleWords = possibleText.split(/\r?\n/).map((word) => word.trim().toUpperCase()).filter((word) => /^[A-Z]{5}$/.test(word));
        validWords = new Set(validText.split(/\r?\n/).map((word) => word.trim().toUpperCase()).filter((word) => /^[A-Z]{5}$/.test(word)));
      } catch (_) {
        possibleWords = [];
      }
      if (!possibleWords.length) possibleWords = fallbacks;
      state.solution = possibleWords[Math.floor(Math.random() * possibleWords.length)] || "CRANE";

      function feedback(guess) {
        const remaining = state.solution.split("");
        const result = Array(5).fill(".");
        for (let i = 0; i < 5; i += 1) if (guess[i] === state.solution[i]) { result[i] = "G"; remaining[i] = ""; }
        for (let i = 0; i < 5; i += 1) {
          if (result[i] === "G") continue;
          const found = remaining.indexOf(guess[i]);
          if (found >= 0) { result[i] = "Y"; remaining[found] = ""; }
        }
        return result.join(" ");
      }
      function render() {
        const lines = [
          "WORDLE // TERMINAL EDITION",
          "────────────────────────────────────",
          "Legend: G = correct spot · Y = in word · . = absent",
          `Attempts: ${state.guesses.length}/6`,
          ""
        ];
        state.guesses.forEach((guess, index) => lines.push(`${index + 1}. ${guess}   ${feedback(guess)}`));
        while (state.guesses.length < 6 && state.guesses.length > 0) lines.push("   _ _ _ _ _");
        if (state.message) { lines.push("", state.message); }
        if (state.guesses.some((guess) => guess === state.solution) || state.guesses.length >= 6) {
          lines.push(`Answer: ${state.solution}`);
        }
        replaceTerminal(lines.join("\n"));
      }
      const form = document.createElement("form");
      form.className = "console-input-wrap";
      const prompt = document.createElement("span");
      prompt.textContent = "guess>";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 5;
      input.autocomplete = "off";
      input.autocapitalize = "characters";
      input.placeholder = "5 letters";
      input.setAttribute("aria-label", "Enter a five-letter Wordle guess");
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "console-control primary";
      submit.textContent = "Enter";
      form.append(prompt, input, submit);
      function ended() { return state.guesses.some((guess) => guess === state.solution) || state.guesses.length >= 6; }
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const guess = input.value.trim().toUpperCase();
        if (!/^[A-Z]{5}$/.test(guess)) state.message = "Enter exactly five letters.";
        else if (validWords.size && !validWords.has(guess) && !possibleWords.includes(guess)) state.message = "That word isn't in the valid-guess list.";
        else if (ended()) state.message = "Game over. Reset to play again.";
        else {
          state.guesses.push(guess);
          if (guess === state.solution) state.message = "Nice! You found the word.";
          else if (state.guesses.length >= 6) state.message = "Out of guesses.";
          else state.message = "Try another word.";
        }
        render();
        input.value = "";
        input.disabled = ended();
        submit.disabled = ended();
      });
      const reset = makeButton("New word", () => {
        state.solution = possibleWords[Math.floor(Math.random() * possibleWords.length)] || "CRANE";
        state.guesses = [];
        state.message = "Type a five-letter guess and press Enter.";
        input.disabled = false;
        submit.disabled = false;
        render();
        input.focus();
      });
      controls.replaceChildren(form, reset);
      render();
    }

    function setupTicTacToePreview() {
      previewHeading.textContent = "Terminal · Tic-Tac-Toe";
      footnote.textContent = "Browser demo: play as X against a small minimax-based O opponent. Original Python variants are in the file list.";
      const state = { board: Array(9).fill(""), over: false, message: "You are X. Choose a square (1–9)." };
      const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      function winner(board) {
        for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
        return board.every(Boolean) ? "tie" : "";
      }
      function minimax(board, aiTurn, depth = 0) {
        const result = winner(board);
        if (result === "O") return 10 - depth;
        if (result === "X") return depth - 10;
        if (result === "tie") return 0;
        let best = aiTurn ? -Infinity : Infinity;
        for (let i = 0; i < 9; i += 1) {
          if (board[i]) continue;
          board[i] = aiTurn ? "O" : "X";
          const score = minimax(board, !aiTurn, depth + 1);
          board[i] = "";
          best = aiTurn ? Math.max(best, score) : Math.min(best, score);
        }
        return best;
      }
      function bestMove() {
        let pick = -1;
        let best = -Infinity;
        for (let i = 0; i < 9; i += 1) {
          if (state.board[i]) continue;
          state.board[i] = "O";
          const score = minimax(state.board, false, 0);
          state.board[i] = "";
          if (score > best) { best = score; pick = i; }
        }
        if (pick >= 0) state.board[pick] = "O";
      }
      function boardText() {
        const cells = state.board.map((value, index) => value || String(index + 1));
        return `${cells[0]} | ${cells[1]} | ${cells[2]}\n--+---+--\n${cells[3]} | ${cells[4]} | ${cells[5]}\n--+---+--\n${cells[6]} | ${cells[7]} | ${cells[8]}`;
      }
      function render() {
        const outcome = winner(state.board);
        let message = state.message;
        if (outcome === "X") message = "You win!";
        else if (outcome === "O") message = "O wins this round.";
        else if (outcome === "tie") message = "It's a tie.";
        state.over = Boolean(outcome);
        replaceTerminal(`TIC-TAC-TOE // X vs O\n────────────────────\n${boardText()}\n\n${message}`);
        controls.replaceChildren();
        for (let i = 0; i < 9; i += 1) {
          const button = makeButton(`${i + 1}: ${state.board[i] || "·"}`, () => play(i), { primary: !state.board[i] });
          button.disabled = state.over || Boolean(state.board[i]);
          controls.appendChild(button);
        }
        controls.appendChild(makeButton("Restart", restart));
      }
      function play(index) {
        if (state.over || state.board[index]) return;
        state.board[index] = "X";
        if (!winner(state.board)) bestMove();
        state.message = "Your move: choose another square.";
        render();
      }
      function restart() {
        state.board = Array(9).fill("");
        state.over = false;
        state.message = "You are X. Choose a square (1–9).";
        render();
      }
      render();
    }

    // Shared initial loading first, then select an appropriate browser preview.
    if (mode === "turtle") setupTurtlePreview();
    else if (mode === "conway") await setupConwayPreview();
    else if (mode === "blackjack") setupBlackjackPreview();
    else if (mode === "wordle") await setupWordlePreview();
    else if (mode === "tic-tac-toe") setupTicTacToePreview();
    else {
      previewHeading.textContent = "Terminal";
      replaceTerminal("Preview ready. Explore the source files on the left.");
    }
  }
})();

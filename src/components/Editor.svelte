<script>
  import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
  import { onDestroy, tick } from "svelte";
  import { keystrokes, position, players, fileUrl } from "../stores";
  import { getLanguageFromUrl } from "../utils";
  import { userState } from "../states";
  import Box from "./common/Box";
  import monacoConfig from "../monaco.config";

  let editor = null; // the editor
  let decorations = []; // editor decorations (gray our text and errors)
  let playersCursors = []; // decoration to show remote players position
  let editorRef = null; // reference to the editor div
  let errorPositions = []; // keep the position of all errors
  let startPosition = null; // store the position where the usert starts the session
  const altKeys = ["Shift", "Control", "Alt", "CapsLock", "Backspace"]; // keys that we should not consider as typed keys

  // Reset position to 1, 1
  const resetPosition = () => {
    $position = { lineNumber: 1, column: 1 };
    scrollTop();
  };

  // Create the editor with custom theme
  const createEditor = () => {
    monaco.editor.defineTheme(monacoConfig.customTheme, monacoConfig.theme);
    editor = monaco.editor.create(
      document.getElementById("monaco"),
      monacoConfig.editor
    );
  };

  // This function will update editor decorations for text not alreay
  // typed (gray) and for errors (red)
  const updateDecorations = () => {
    if (!["offline.active", "online.playing"].some($userState.matches)) {
      return;
    }

    let newDecorations = [];

    newDecorations.push({
      options: { inlineClassName: "grayedOut" },
      range: new monaco.Range(
        1,
        1,
        startPosition.lineNumber,
        startPosition.column - 1
      ),
    });

    newDecorations = newDecorations.concat(
      errorPositions.map((pos) => ({
        options: { inlineClassName: "error" },
        range: new monaco.Range(
          pos.lineNumber,
          pos.column - 1,
          pos.lineNumber,
          pos.column
        ),
      }))
    );

    newDecorations.push({
      options: { inlineClassName: "grayedOut" },
      range: new monaco.Range(
        $position.lineNumber,
        $position.column,
        1000,
        1000
      ),
    });

    decorations = editor.deltaDecorations(decorations, newDecorations);
  };

  // Hide 'cannot edit in read-only editor' tooltip
  // see https://github.com/microsoft/monaco-editor/issues/1742#issuecomment-571908392
  const hideReadOnlyTooltip = () => {
    // This is now hidden by global css rule because following method was not working
    // const messageContribution = editor.getContribution(
    //   "editor.contrib.messageController"
    // );
    // editor.onDidAttemptReadOnlyEdit(() => messageContribution.closeMessage());
  };

  // Reload custom font sizing when the font is fetched
  // see https://github.com/microsoft/monaco-editor/issues/648#issuecomment-564978560
  const remeasureFonts = (delay = 350) => {
    setTimeout(monaco.editor.remeasureFonts, delay);
  };

  // Set the editor language
  const setEditorLanguage = (language) => {
    monaco.editor.setModelLanguage(editor.getModel(), language);
  };

  // Update the editor content
  const setEditorContent = (content) => {
    editor.getModel().setValue(content);
  };

  // Only let cursor position to be updated from `api` or by human if the state is
  // in some specific states
  const preventPositionChange = () => {
    editor.onDidChangeCursorPosition((e) => {
      if (
        ["offline.inactive", "online.lobby"].some($userState.matches) ||
        e.source === "api"
      ) {
        $position = { ...editor.getPosition() };
      } else {
        editor.setPosition($position);
      }
    });
  };

  // On focus set state active
  const handleFocus = () => {
    // editor.onDidFocusEditorText(() => {
    // });
  };

  // On blur set state paused
  const handleBlur = () => {
    editor.onDidBlurEditorText(() => {
      if (["offline.active", "online.playing"].some($userState.matches)) {
        userState.send("PAUSE");
      }
    });
  };

  // Catch user keypress and check if the cursor should move
  const handleTyping = () => {
    editor.onKeyDown((e) => {
      const typedKey = e.browserEvent.key; // typed key

      if (altKeys.includes(typedKey)) return;

      if ($userState.matches("offline.inactive")) {
        startPosition = $position;
        errorPositions = [];
      }

      userState.send("START");

      let typedChars = [...$keystrokes.typedChars, typedKey];
      let correctChars = $keystrokes.correctChars;

      // Find out next character
      let nextChar = editor.getModel().getValueInRange({
        startColumn: $position.column,
        endColumn: $position.column + 1,
        startLineNumber: $position.lineNumber,
        endLineNumber: $position.lineNumber,
      });

      // If the user typed the correct character move one position to the right
      if (nextChar === typedKey) {
        $position.column++;
        correctChars = $keystrokes.correctChars + 1;
      } else {
        errorPositions.push($position);
      }

      // Update typed characters and correctChars atomically
      // (we need this because otherwise $metrics will calculate wrong numbers)
      $keystrokes = {
        typedChars: typedChars,
        correctChars: correctChars,
      };

      // If we are at the end of the line and the Enter is pressed
      // than go on next line
      if (!nextChar && typedKey === "Enter") {
        $position.lineNumber++;
        let lineText;

        try {
          lineText = editor.getModel().getLineContent($position.lineNumber);
        } catch (e) {
          // If there is not a next char it means that the user
          // reached the end of the file. We should end the session
          userState.send("END");
        }

        // Find out first non whitespace position on next line
        let firstNotWhiteSpace = lineText.match(/\S/);
        let culumn = firstNotWhiteSpace ? firstNotWhiteSpace.index : 0;
        $position.column = culumn + 1;
        editor.setPosition($position);
      }
    });
  };

  // Handle file url change
  const handleFileUrlUpdate = () => {
    const url = $fileUrl;
    setEditorContent("Loading content...");

    if (url) {
      fetch(url)
        .then((res) => res.text())
        .then((content) => {
          setEditorContent(content);
          resetPosition();
        })
        .catch((e) => console.error(e));

      const language = getLanguageFromUrl(url);
      setEditorLanguage(language);
    }
  };

  // Draw cursor decoration for online players
  const updateCursors = () => {
    if (!$userState.matches("online.playing")) return;

    let ranges = $players.map((state, i) => ({
      range: new monaco.Range(
        state.position.lineNumber,
        state.position.column,
        state.position.lineNumber,
        state.position.column
      ),
      options: { className: `cursor cursor-${(i % 3) + 1}` },
    }));

    playersCursors = editor.deltaDecorations(playersCursors, ranges);
  };

  // Reset players cursors
  const removeCursors = () => {
    playersCursors = editor.deltaDecorations(playersCursors, []);
  };

  // Set editor position from local position object
  const updatePosition = () => {
    editor.setPosition($position);
  };

  // Prevent keyboard navigation (tab and spacebar to scroll)
  // when the editor has focus
  const preventKeyboardNavigation = () => {
    document.onkeydown = function (e) {
      // If the editor has focus and the key press is a navigation key
      // prevent default
      if (
        editorRef.contains(document.activeElement) &&
        ["Space", "Tab", ""].includes(e.code)
      ) {
        e.preventDefault();
      }
    };
  };

  // Scroll the editor to the top
  const scrollTop = () => {
    editor.setScrollPosition({ scrollTop: 0 });
  };

  tick().then(() => {
    // Create the editor with default theme
    createEditor();

    // Hide 'cannot edit in read-only editor' tooltip
    hideReadOnlyTooltip();

    // Reload custom font sizing when the font is fetched
    remeasureFonts();

    // Only let cursor position to be changed from api
    preventPositionChange();

    // Catch user keypress and check if the cursor should move
    handleTyping();

    // Set active state when the editor gets focus
    handleFocus();

    // Set state as paused on editor blur
    handleBlur();

    // Prevent keybord navigation when the editor has focus
    preventKeyboardNavigation();
  });

  // Handle file change
  $: editor && $fileUrl && handleFileUrlUpdate();

  // Update remote players cursors
  $: editor && $players && updateCursors();

  // When the match finishes remove players cursors
  $: editor && $userState.matches("online.finished") && removeCursors();

  // Reset decoration (gray text) when the match finishes
  $: editor && $userState.matches("online.finished") && resetPosition();

  // Update editor position when the position changes
  $: editor && $position && updatePosition();

  // When the position changes update the decorations
  $: editor && $position && updateDecorations();

  // When the user state goes from ended to inactive (closes the end session chart)
  // set focus on the editor to let the user starts a new match easily
  const unsubscribeUserState = userState.subscribe((state) => {
    const wasEnded = state.history && state.history.matches("offline.ended");
    const isInactive = state.matches("offline.inactive");
    if (editor && wasEnded && isInactive) editor.focus();

    // When a match ends remove focus from the editor so no new type are registered
    // see https://github.com/microsoft/monaco-editor/issues/307#issuecomment-272398610
    if (editor && state.matches("offline.ended") && editor.hasTextFocus()) {
      document.activeElement.blur();
    }
  });

  // Remove listeners when component is destroyed
  onDestroy(() => {
    // Set the user as stopped
    userState.send("STOP");

    // Remove listener on key down
    document.onkeydown = null;

    // This check is needed to avoid development error with webpack hot-reload
    if (typeof unsubscribeUserState === "function") unsubscribeUserState();
  });
</script>

<Box>
  <div class="autoHeight p-4">
    <div bind:this={editorRef} class="h-full w-full" id="monaco" tabindex="0" />
  </div>
</Box>

<style>
  .autoHeight {
    height: calc(100vh - 160px); /* full height minus header and margins */
  }
</style>

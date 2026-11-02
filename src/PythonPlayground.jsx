import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";

const PYODIDE_CDN_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js";

const DEFAULT_CODE = `# Pygame-CE Browser Demo
import asyncio
import pygame

async def main():
    pygame.init()
    screen = pygame.display.set_mode((400, 400))
    clock = pygame.time.Clock()

    x, y = 200, 200
    radius = 30
    speed_x, speed_y = 3, 2

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # Move circle
        x += speed_x
        y += speed_y

        if x - radius <= 0 or x + radius >= 400:
            speed_x = -speed_x
        if y - radius <= 0 or y + radius >= 400:
            speed_y = -speed_y

        # Draw frame
        screen.fill((20, 24, 39))
        pygame.draw.circle(screen, (74, 222, 128), (x, y), radius)
        pygame.display.flip()

        # Let the browser draw the frame
        await asyncio.sleep(0)

await main()
`;

export default function PythonPlayground() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [outputLogs, setOutputLogs] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Initializing sandbox...");
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const pyodideRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const canvasRef = useRef(null);

  const appendLog = (text, type = "info") => {
    setOutputLogs((prev) => [...prev, { text, type, id: crypto.randomUUID() }]);
  };

  useEffect(() => {
    let isMounted = true;

    const setupPyodide = async () => {
      try {
        // Ensure Emscripten targets the canvas element
        window.Module = window.Module || {};
        if (canvasRef.current) {
          window.Module.canvas = canvasRef.current;
        }

        // Dynamically load the Pyodide CDN script if not loaded
        if (!window.loadPyodide) {
          const script = document.createElement("script");
          script.src = PYODIDE_CDN_URL;
          script.async = true;
          document.body.appendChild(script);

          await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error("Failed to load Pyodide CDN."));
          });
        }

        setStatusMessage("Loading WebAssembly Python core...");
        const pyodide = await window.loadPyodide({
          stdout: (text) => appendLog(text, "stdout"),
          stderr: (text) => appendLog(text, "stderr"),
        });

        setStatusMessage("Installing pygame-ce...");
        appendLog("Downloading and compiling pygame-ce...", "info");

        // Use Pyodide package loader directly
        await pyodide.loadPackage("micropip");
        await pyodide.runPythonAsync(`
          import micropip
          await micropip.install("pygame-ce")
        `);

        if (isMounted) {
          pyodideRef.current = pyodide;
          setIsPyodideReady(true);
          setStatusMessage("Ready");
          appendLog("Pygame environment successfully initialized!", "info");
        }
      } catch (err) {
        if (isMounted) {
          setStatusMessage("Initialization Failed");
          appendLog(`Error: ${err.message}`, "error");
        }
      }
    };

    setupPyodide();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleRunCode = async () => {
    if (!pyodideRef.current || isRunning) return;

    setIsRunning(true);
    setOutputLogs([]);
    appendLog("Executing script...", "info");

    try {
      // Bind canvas directly into Pyodide and Emscripten runtime
      const canvasEl = canvasRef.current;
      if (canvasEl) {
        pyodideRef.current.canvas.setCanvas2D(canvasEl);
        window.Module.canvas = canvasEl;
      }

      // Execute code asynchronously
      await pyodideRef.current.runPythonAsync(code);
      appendLog("Program completed.", "info");
    } catch (err) {
      appendLog(err.message || String(err), "error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header Bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Python & Pygame Interactive Lab</h2>
          <span style={styles.badge}>{statusMessage}</span>
        </div>
        <button
          onClick={handleRunCode}
          disabled={!isPyodideReady || isRunning}
          style={{
            ...styles.runBtn,
            ...(!isPyodideReady || isRunning ? styles.btnDisabled : {}),
          }}
        >
          {isRunning ? "Running..." : "Run Code"}
        </button>
      </header>

      {/* Main Split Panels */}
      <div style={styles.workspace}>
        {/* Monaco Editor (Left) */}
        <div style={styles.editorPanel}>
          <div style={styles.panelTitle}>editor.py</div>
          <div style={styles.editorContainer}>
            <Editor
              height="100%"
              theme="vs-dark"
              defaultLanguage="python"
              value={code}
              onChange={(val) => setCode(val || "")}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
              }}
            />
          </div>
        </div>

        {/* Graphical Canvas (Right) */}
        <div style={styles.canvasPanel}>
          <div style={styles.panelTitle}>Display Output (&lt;canvas&gt;)</div>
          <div style={styles.canvasContainer}>
            <canvas
              ref={canvasRef}
              id="canvas"
              width={400}
              height={400}
              tabIndex={1}
              style={styles.canvas}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>
      </div>

      {/* Bottom Output Terminal */}
      <div style={styles.terminalPanel}>
        <div style={styles.panelTitle}>Terminal & Diagnostic Logs</div>
        <div style={styles.terminalBody}>
          {outputLogs.map((log) => (
            <div
              key={log.id}
              style={{
                ...styles.logLine,
                color:
                  log.type === "error"
                    ? "#f87171"
                    : log.type === "stdout"
                    ? "#38bdf8"
                    : "#4ade80",
              }}
            >
              {log.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    fontFamily: "monospace",
    overflow: "hidden",
  },
  header: {
    height: "50px",
    backgroundColor: "#1e293b",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 16px",
    borderBottom: "1px solid #334155",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  title: {
    fontSize: "15px",
    margin: 0,
    fontWeight: "bold",
  },
  badge: {
    backgroundColor: "#0f172a",
    padding: "4px 8px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid #334155",
    color: "#94a3b8",
  },
  runBtn: {
    backgroundColor: "#22c55e",
    color: "#052e16",
    border: "none",
    borderRadius: "4px",
    padding: "6px 16px",
    fontWeight: "bold",
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  workspace: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  },
  editorPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #334155",
    minWidth: 0,
  },
  editorContainer: {
    flex: 1,
    minHeight: 0,
  },
  canvasPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#020617",
    minWidth: 0,
  },
  canvasContainer: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    backgroundColor: "#141827",
    border: "2px solid #334155",
    borderRadius: "8px",
  },
  terminalPanel: {
    height: "180px",
    backgroundColor: "#020617",
    borderTop: "1px solid #334155",
    display: "flex",
    flexDirection: "column",
  },
  panelTitle: {
    height: "26px",
    backgroundColor: "#1e293b",
    fontSize: "11px",
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    borderBottom: "1px solid #334155",
  },
  terminalBody: {
    flex: 1,
    padding: "8px 12px",
    overflowY: "auto",
    fontSize: "13px",
  },
  logLine: {
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  },
};
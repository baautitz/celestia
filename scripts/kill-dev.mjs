// Encerra o que o `pnpm dev` deixou de pé: servidor (3000), autoridade certificadora (3001) e o Vite (5173-5180).
import { execFileSync } from "node:child_process";

const PORTAS = new Set([3000, 3001, ...Array.from({ length: 8 }, (_, i) => 5173 + i)]);

const pids = new Set();
for (const linha of execFileSync("ss", ["-ltnpH"], { encoding: "utf8" }).split("\n")) {
  const porta = Number(linha.match(/:(\d+)\s+\S+\s+users:/)?.[1]);
  if (!PORTAS.has(porta)) continue;
  for (const m of linha.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
}

if (pids.size === 0) console.log("Nada rodando nas portas do dev.");
for (const pid of pids) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`Encerrado o processo ${pid}.`);
  } catch (e) {
    console.log(`Processo ${pid}: ${e.message}`);
  }
}

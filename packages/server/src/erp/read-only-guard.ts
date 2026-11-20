const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|deny|backup|restore|shutdown|into|openrowset|opendatasource|xp_\w+|sp_\w+)\b/i;

/**
 * Remove comentários e esvazia literais e identificadores delimitados em UMA passada da esquerda para a direita,
 * na ordem do texto: só assim um `--` dentro de um literal (ou um `'` dentro de um comentário) não é confundido
 * com o outro. Literais viram `''`, identificadores `[x]`/`"x"` viram `[]`, comentários viram um espaço.
 * Comentários de bloco aninham (como no T-SQL); construções sem fechamento vão até o fim do texto.
 */
function maskSql(sqlText: string): string {
  let out = "";
  let i = 0;
  const n = sqlText.length;
  while (i < n) {
    const ch = sqlText[i];
    const next = sqlText[i + 1];
    if (ch === "-" && next === "-") {
      const end = sqlText.indexOf("\n", i);
      i = end === -1 ? n : end;
      out += " ";
    } else if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sqlText[i] === "/" && sqlText[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sqlText[i] === "*" && sqlText[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
    } else if (ch === "'" || ch === '"' || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      i++;
      while (i < n) {
        if (sqlText[i] === close) {
          if (sqlText[i + 1] === close) i += 2; // aspa/colchete escapado por duplicação
          else break;
        } else {
          i++;
        }
      }
      i++; // fechamento (ou fim do texto)
      out += ch === "'" ? "''" : "[]";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Garante que a consulta é uma leitura. Camada extra: a proteção principal é o usuário somente leitura do banco.
 */
export function assertReadOnlyQuery(sqlText: string): void {
  const code = maskSql(sqlText).trim();

  if (!/^(select|with)\b/i.test(code)) {
    throw new Error("Somente consultas SELECT/WITH são permitidas nas fontes de dados.");
  }
  if (code.replace(/;\s*$/, "").includes(";")) {
    throw new Error("Múltiplas instruções não são permitidas nas fontes de dados.");
  }
  const forbidden = code.match(FORBIDDEN);
  if (forbidden) {
    throw new Error(`Comando não permitido em fonte somente leitura: ${forbidden[1]!.toUpperCase()}.`);
  }
}

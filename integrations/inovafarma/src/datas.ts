/** Formatação das datas do ERP e do Plugin, igual no servidor e na tela, sem conversão de fuso. */

/** `AAAA-MM-DD` como `DD/MM/AAAA` (e `AAAA-MM` como `MM/AAAA`). */
export const dataBr = (data: string) => data.split("-").reverse().join("/");

/** `AAAA-MM-DD HH:MM:SS` (hora do ERP) como `DD/MM/AAAA HH:MM`. */
export const dataHora = (data: string) => {
  const [dia = "", hora = ""] = data.split(" ");
  return `${dataBr(dia)} ${hora.slice(0, 5)}`.trim();
};

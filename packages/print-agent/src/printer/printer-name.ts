/**
 * The ONE definition of a valid Windows printer name, shared by config and the Windows backend.
 * Letters/digits of any language (Spanish accents, ñ), spaces and . _ - ( ) # / & + ' , ; an optional
 * \SERVER\ prefix for shared printers. The first character must be a letter or digit, which also keeps
 * a name from being read as a PowerShell parameter ("-Verbose"). Quotes, control characters, % | < > * ?
 * ; ` $ are rejected. The name is always passed as a separate argument, never interpolated.
 */
export const PRINTER_NAME_PATTERN = /^(?:\\\\[\p{L}\p{N}._-]+\\)?[\p{L}\p{N}][\p{L}\p{N} _.\-()#/&+',]{0,99}$/u;

export const PRINTER_NAME_HELP = "solo letras (con acentos), números, espacios y . _ - ( ) # / & + ' , (máximo 100), opcionalmente \\\\SERVIDOR\\ al principio; debe empezar con letra o número";

export function isValidPrinterName(name: string): boolean {
  return PRINTER_NAME_PATTERN.test(name);
}

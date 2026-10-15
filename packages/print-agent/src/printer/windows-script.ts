import { createHash } from "node:crypto";

/**
 * The PowerShell script that writes RAW bytes to a Windows printer through the spooler (winspool.drv),
 * so it works with the printer's normal installed driver, even "Generic / Text Only".
 *
 * It is a CONSTANT: the printer name, the data file and the document title reach it only as
 * parameters (-PrinterName, -DataPath, -DocName), never by string interpolation. Pure ASCII on
 * purpose: Windows PowerShell 5.1 reads BOM-less files in the ANSI code page.
 *
 * Exit codes: 0 printed | 2 printer not found | 3 the spooler/printer rejected the data | 4 internal error | 5 print spooler not running.
 */
export const RAW_PRINT_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath,
  [string]$DocName = 'BurgerHouse'
)
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public static class BhRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, ref DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] buffer, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);

  // 0 = printed, 2 = printer not found, 3 = failed, 5 = spooler unreachable (win32 error in err)
  public static int Send(string printer, byte[] data, string docName, out int err) {
    err = 0;
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      err = Marshal.GetLastWin32Error();
      if (err == 1722 || err == 1721 || err == 1753) return 5;
      return (err == 1801 || err == 2) ? 2 : 3;
    }
    int rc = 3;
    bool doc = false, page = false;
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = docName;
      di.pOutputFile = null;
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, ref di) == 0) { err = Marshal.GetLastWin32Error(); return 3; }
      doc = true;
      if (!StartPagePrinter(h)) { err = Marshal.GetLastWin32Error(); return 3; }
      page = true;
      int written;
      if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) {
        err = Marshal.GetLastWin32Error();
        return 3;
      }
      rc = 0;
    } finally {
      if (page) EndPagePrinter(h);
      if (doc) EndDocPrinter(h);
      ClosePrinter(h);
    }
    return rc;
  }
}
'@
try {
  Add-Type -TypeDefinition $source -Language CSharp
  $bytes = [System.IO.File]::ReadAllBytes($DataPath)
  $err = 0
  $rc = [BhRawPrinter]::Send($PrinterName, $bytes, $DocName, [ref]$err)
  if ($rc -eq 2) { [Console]::Error.WriteLine('PRINTER_NOT_FOUND ' + $err); exit 2 }
  if ($rc -eq 5) { [Console]::Error.WriteLine('SPOOLER_DOWN ' + $err); exit 5 }
  if ($rc -ne 0) { [Console]::Error.WriteLine('WRITE_FAILED ' + $err); exit 3 }
  exit 0
} catch {
  [Console]::Error.WriteLine('SCRIPT_ERROR ' + $_.Exception.GetType().Name)
  exit 4
}
`;

export function scriptHash(script: string = RAW_PRINT_SCRIPT): string {
  return createHash("sha256").update(script, "utf8").digest("hex");
}

import { createHash } from "node:crypto";

/**
 * The PowerShell script that writes RAW bytes to a Windows printer through the spooler (winspool.drv),
 * so it works with the printer's normal installed driver, even "Generic / Text Only".
 *
 * It is a CONSTANT: the printer name, the data file and the document title reach it only as
 * parameters (-PrinterName, -DataPath, -DocName), never by string interpolation. Pure ASCII on
 * purpose: Windows PowerShell 5.1 reads BOM-less files in the ANSI code page.
 *
 * Pre-flight: the Spooler happily ACCEPTS jobs for an unplugged / paper-out USB printer (WritePrinter then
 * succeeds and the job prints later, in a burst). So before StartDocPrinter the script reads the printer
 * state with GetPrinter level 2 (PRINTER_INFO_2 Status/Attributes, P/Invoke: available in every Windows
 * PowerShell 5.1, no PrintManagement module needed) and refuses when a bit of -StatusMask / -AttrMask
 * (built from printer-status.ts) is set. A driver that reports nothing (0) never blocks the job.
 *
 * Exit codes: 0 printed | 2 printer not found | 3 the spooler/printer rejected the data | 4 internal error |
 * 5 print spooler not running | 6 printer not ready (stderr: PRINTER_STATE <status> <attributes>).
 */
export const RAW_PRINT_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath,
  [string]$DocName = 'BurgerHouse',
  [int]$StatusMask = 0,
  [int]$AttrMask = 0
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
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PRINTER_INFO_2 {
    public string pServerName;
    public string pPrinterName;
    public string pShareName;
    public string pPortName;
    public string pDriverName;
    public string pComment;
    public string pLocation;
    public IntPtr pDevMode;
    public string pSepFile;
    public string pPrintProcessor;
    public string pDatatype;
    public string pParameters;
    public IntPtr pSecurityDescriptor;
    public uint Attributes;
    public uint Priority;
    public uint DefaultPriority;
    public uint StartTime;
    public uint UntilTime;
    public uint Status;
    public uint cJobs;
    public uint AveragePPM;
  }
  [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool GetPrinter(IntPtr handle, int level, IntPtr buffer, int size, out int needed);
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

  // false when the driver gives no state: the job then proceeds (never block on missing information)
  static bool ReadState(IntPtr h, out uint status, out uint attrs) {
    status = 0; attrs = 0;
    int needed;
    GetPrinter(h, 2, IntPtr.Zero, 0, out needed);
    if (needed <= 0) return false;
    IntPtr buf = Marshal.AllocHGlobal(needed);
    try {
      int got;
      if (!GetPrinter(h, 2, buf, needed, out got)) return false;
      PRINTER_INFO_2 info = (PRINTER_INFO_2)Marshal.PtrToStructure(buf, typeof(PRINTER_INFO_2));
      status = info.Status;
      attrs = info.Attributes;
      return true;
    } catch (Exception) {
      return false;
    } finally {
      Marshal.FreeHGlobal(buf);
    }
  }

  // 0 = printed, 2 = printer not found, 3 = failed, 5 = spooler unreachable, 6 = printer not ready
  // (win32 error in err; the raw state in status / attrs)
  public static int Send(string printer, byte[] data, string docName, uint statusMask, uint attrMask, out int err, out uint status, out uint attrs) {
    err = 0; status = 0; attrs = 0;
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      err = Marshal.GetLastWin32Error();
      if (err == 1722 || err == 1721 || err == 1753) return 5;
      return (err == 1801 || err == 2) ? 2 : 3;
    }
    int rc = 3;
    bool doc = false, page = false;
    try {
      if (ReadState(h, out status, out attrs) && ((status & statusMask) != 0 || (attrs & attrMask) != 0)) {
        rc = 6;
        return rc;
      }
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
  $st = [uint32]0
  $at = [uint32]0
  $rc = [BhRawPrinter]::Send($PrinterName, $bytes, $DocName, [uint32]$StatusMask, [uint32]$AttrMask, [ref]$err, [ref]$st, [ref]$at)
  if ($rc -eq 2) { [Console]::Error.WriteLine('PRINTER_NOT_FOUND ' + $err); exit 2 }
  if ($rc -eq 6) { [Console]::Error.WriteLine('PRINTER_STATE ' + $st + ' ' + $at); exit 6 }
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

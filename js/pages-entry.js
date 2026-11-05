function styleBillingSummarySheet(XLSX) {
  if (!XLSX || XLSX.__billingSummaryStyleInstalled) return;
  const originalWrite = XLSX.write.bind(XLSX);
  XLSX.write = (workbook, options) => {
    const sheet = workbook?.Sheets?.["Resumen del ciclo"];
    if (sheet) {
      sheet["!cols"] = [{ wch: 42 }, { wch: 30 }];
      sheet["!views"] = [{ showGridLines: true }];
      sheet["!rows"] = Array.from({ length: 20 }, (_, index) => ({ hpt: index === 0 ? 22 : 18 }));
      sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];

      const setStyle = (address, style) => {
        if (sheet[address]) sheet[address].s = style;
      };
      const simpleCell = {
        alignment: { vertical: "center", horizontal: "left" },
        font: { name: "Calibri", sz: 11 }
      };
      const valueCell = {
        alignment: { vertical: "center", horizontal: "right" },
        font: { name: "Calibri", sz: 11 }
      };
      for (let row = 4; row <= 20; row++) {
        if (row === 12 || row === 13 || row === 16) continue;
        setStyle(`A${row}`, simpleCell);
        setStyle(`B${row}`, valueCell);
      }

      setStyle("A1", {
        fill: { fgColor: { rgb: "244062" } },
        font: { name: "Calibri", bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
        alignment: { horizontal: "center", vertical: "center" }
      });
      setStyle("A2", {
        ...simpleCell,
        font: { name: "Calibri", bold: true, sz: 11 },
        alignment: { horizontal: "center", vertical: "center" }
      });
      setStyle("B2", {
        ...valueCell,
        font: { name: "Calibri", bold: true, sz: 11 },
        alignment: { horizontal: "center", vertical: "center" }
      });

      for (const row of [3, 13, 16]) {
        for (const col of ["A", "B"]) {
          setStyle(`${col}${row}`, {
            fill: { fgColor: { rgb: "4472C4" } },
            font: { name: "Calibri", bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
            alignment: { horizontal: "center", vertical: "center" }
          });
        }
      }
    }
    return originalWrite(workbook, options);
  };
  XLSX.__billingSummaryStyleInstalled = true;
}

// Register before the enhancement module loads the XLSX browser bundle so the
// summary layout is applied before the first workbook is written.
document.addEventListener("load", event => {
  const src = event.target?.src || "";
  if (src.includes("xlsx-js-style")) styleBillingSummarySheet(window.XLSX);
}, true);

await import("./enhancements.js");

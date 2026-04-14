const runOcrBtn = document.getElementById("runOcr");
const ocrFile = document.getElementById("ocrFile");
const ocrResult = document.getElementById("ocrResult");

if (runOcrBtn) {
  runOcrBtn.addEventListener("click", async () => {
    const file = ocrFile.files[0];
    if (!file) {
      ocrResult.value = "Please select a file.";
      return;
    }
    ocrResult.value = "Running OCR...";
    try {
      const { data } = await Tesseract.recognize(file, "eng");
      ocrResult.value = data.text.trim();
    } catch (err) {
      ocrResult.value = "OCR failed.";
    }
  });
}

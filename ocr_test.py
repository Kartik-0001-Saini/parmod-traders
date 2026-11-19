from rapidocr_onnxruntime import RapidOCR
import time

start = time.time()
engine = RapidOCR()
result, _ = engine(r"testbill\bill1.jpeg")
print("Time (seconds):", round(time.time() - start, 1))
print("Total text pieces:", len(result) if result else 0)

with open(r"testbill\ocr_out.txt", "w", encoding="utf-8") as f:
    for box, text, conf in result:
        x = int(box[0][0])
        y = int(box[0][1])
        f.write(f"y={y} x={x} conf={float(conf):.2f} | {text}\n")
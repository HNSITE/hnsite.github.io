// Firebase Storage를 활성화할 때 그대로 사용하는 이미지 사용량 제한 정책입니다.
// 현재 버전에서는 Storage 업로드는 연결하지 않고 정책과 압축 함수만 준비합니다.
export const BINGO_IMAGE_POLICY = Object.freeze({
  maxStoredBytes: 2 * 1024 * 1024,
  targetBytes: 1 * 1024 * 1024,
  maxWidth: 1920,
  maxHeight: 1920,
  outputType: "image/webp",
  fixedFileName: "board.webp"
});

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("이미지 압축에 실패했습니다."));
    }, type, quality);
  });
}

export async function compressBingoImage(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("이미지 파일만 선택할 수 있습니다.");
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    BINGO_IMAGE_POLICY.maxWidth / image.naturalWidth,
    BINGO_IMAGE_POLICY.maxHeight / image.naturalHeight
  );

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, BINGO_IMAGE_POLICY.outputType, quality);

  while (blob.size > BINGO_IMAGE_POLICY.targetBytes && quality > 0.42) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, BINGO_IMAGE_POLICY.outputType, quality);
  }

  if (blob.size > BINGO_IMAGE_POLICY.maxStoredBytes) {
    throw new Error("압축 후에도 2MB를 넘습니다. 더 작은 사진을 선택해주세요.");
  }

  return blob;
}

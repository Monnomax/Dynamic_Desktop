export function getNumberedImageSequence(images, getBasename) {
    if (!Array.isArray(images) || typeof getBasename !== "function")
        return null;

    const byNumber = new Map();

    for (const image of images) {
        const filename = getBasename(image);
        const extensionIndex = filename.lastIndexOf(".");
        const stem =
            extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
        const numberTokens = stem.match(/\d+/g);

        if (!numberTokens || numberTokens.length !== 1) return null;

        const number = Number(numberTokens[0]);

        if (!Number.isSafeInteger(number) || number < 1 || byNumber.has(number))
            return null;

        byNumber.set(number, image);
    }

    const sequence = [];

    for (let number = 1; number <= images.length; number++) {
        if (!byNumber.has(number)) return null;
        sequence.push(byNumber.get(number));
    }

    return sequence;
}

export function getDefaultScheduleMinutes(
    imageCount,
    useSixteenFrameDayCycle = false,
) {
    if (!Number.isInteger(imageCount) || imageCount < 0) return [];

    if (useSixteenFrameDayCycle && imageCount === 16) {
        return [
            300, 360, 420, 480, 540, 600, 660, 780, 840, 900, 960, 1020, 1080,
            1200, 1380, 180,
        ];
    }

    return Array.from({ length: imageCount }, (_, index) =>
        Math.floor((index * 1440) / imageCount),
    );
}

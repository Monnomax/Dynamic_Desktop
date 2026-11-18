const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function angularDistanceFromScore(score) {
    return Math.acos(Math.max(-1, Math.min(1, score))) * DEG;
}

/**
 * Calculates the Sun's approximate altitude and compass azimuth.
 * The date must represent an absolute instant; local Date objects
 * are supported and converted using their underlying timestamp.
 */
export function calculateSolarPosition(date, latitudeDegrees, longitudeDegrees) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
        throw new Error('A valid Date is required');

    if (
        !Number.isFinite(latitudeDegrees) ||
        latitudeDegrees < -90 ||
        latitudeDegrees > 90
    ) {
        throw new Error('Latitude must be between -90 and 90 degrees');
    }

    if (
        !Number.isFinite(longitudeDegrees) ||
        longitudeDegrees < -180 ||
        longitudeDegrees > 180
    ) {
        throw new Error('Longitude must be between -180 and 180 degrees');
    }

    const day = date.getTime() / 86400000 - 10957.5;
    const meanAnomaly = RAD * (357.5291 + 0.98560028 * day);

    const eclipticLongitude = (
        meanAnomaly
        + RAD * (
            1.9148 * Math.sin(meanAnomaly)
            + 0.0200 * Math.sin(2 * meanAnomaly)
            + 0.0003 * Math.sin(3 * meanAnomaly)
        )
        + RAD * 102.9372
        + Math.PI
    );

    const obliquity = RAD * 23.4397;

    const rightAscension = Math.atan2(
        Math.sin(eclipticLongitude) * Math.cos(obliquity),
        Math.cos(eclipticLongitude)
    );

    const declination = Math.asin(
        Math.sin(obliquity) * Math.sin(eclipticLongitude)
    );

    const latitude = latitudeDegrees * RAD;
    const longitude = longitudeDegrees * RAD;

    const siderealTime =
        RAD * (280.16 + 360.9856235 * day) + longitude;

    const hourAngle = siderealTime - rightAscension;

    const altitude = Math.asin(
        Math.sin(latitude) * Math.sin(declination)
        + Math.cos(latitude) * Math.cos(declination)
        * Math.cos(hourAngle)
    );

    const azimuth = (
        Math.atan2(
            Math.sin(hourAngle),
            Math.cos(hourAngle) * Math.sin(latitude)
            - Math.tan(declination) * Math.cos(latitude)
        ) + Math.PI
    );

    return {
        altitude: altitude * DEG,
        azimuth: ((azimuth * DEG) % 360 + 360) % 360,
    };
}

/**
 * Selects the nearest solar anchor and applies hysteresis.
 *
 * Each anchor has:
 *   image: image path or identifier
 *   altitude: solar altitude in degrees
 *   azimuth: compass azimuth in degrees
 *
 * distanceAdvantage is positive when the new candidate is closer
 * to the calculated solar position than the currently displayed frame.
 */
export function selectSolarFrame(
    sun,
    anchors,
    currentImage = null,
    hysteresisDegrees = 0.5
) {
    if (!Array.isArray(anchors) || anchors.length === 0)
        throw new Error('At least one solar anchor is required');

    if (
        !Number.isFinite(sun.altitude) ||
        !Number.isFinite(sun.azimuth)
    ) {
        throw new Error('Invalid solar position');
    }

    if (!Number.isFinite(hysteresisDegrees) || hysteresisDegrees < 0)
        throw new Error('Hysteresis must be a non-negative number');

    const sunAltitude = sun.altitude * RAD;
    const sunAzimuth = sun.azimuth * RAD;

    const scoreFor = anchor => {
        if (
            !anchor ||
            !Number.isFinite(anchor.altitude) ||
            !Number.isFinite(anchor.azimuth)
        ) {
            throw new Error('Invalid solar anchor');
        }

        const anchorAltitude = anchor.altitude * RAD;
        const anchorAzimuth = anchor.azimuth * RAD;

        return (
            Math.sin(sunAltitude) * Math.sin(anchorAltitude)
            + Math.cos(sunAltitude) * Math.cos(anchorAltitude)
            * Math.cos(sunAzimuth - anchorAzimuth)
        );
    };

    let nearestAnchor = anchors[0];
    let nearestScore = scoreFor(nearestAnchor);

    for (const anchor of anchors.slice(1)) {
        const score = scoreFor(anchor);

        if (score > nearestScore) {
            nearestAnchor = anchor;
            nearestScore = score;
        }
    }

    let selectedAnchor = nearestAnchor;
    let selectedScore = nearestScore;
    let distanceAdvantage = null;
    let hysteresisAction = 'none';

    const currentAnchor = currentImage === null
        ? null
        : anchors.find(anchor => anchor.image === currentImage) ?? null;

    if (currentAnchor && currentAnchor.image !== nearestAnchor.image) {
        const currentScore = scoreFor(currentAnchor);

        distanceAdvantage =
            angularDistanceFromScore(currentScore)
            - angularDistanceFromScore(nearestScore);

        if (distanceAdvantage < hysteresisDegrees) {
            selectedAnchor = currentAnchor;
            selectedScore = currentScore;
            hysteresisAction = 'hold';
        } else {
            hysteresisAction = 'switch';
        }
    }

    return {
        selectedAnchor,
        nearestAnchor,
        selectedScore,
        nearestScore,
        distanceAdvantage,
        hysteresisAction,
    };
}

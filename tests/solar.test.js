import {
    calculateSolarPosition,
    selectSolarFrame,
} from '../solar.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(`FAIL: ${message}`);

    print(`PASS: ${message}`);
}

function assertNear(actual, expected, tolerance, message) {
    assert(
        Math.abs(actual - expected) <= tolerance,
        `${message} (actual=${actual.toFixed(4)}, expected=${expected})`
    );
}

function testSolarCoordinates() {
    const equinoxNoon = calculateSolarPosition(
        new Date('2026-03-20T12:00:00Z'),
        0,
        0
    );

    const equinoxMidnight = calculateSolarPosition(
        new Date('2026-03-20T00:00:00Z'),
        0,
        0
    );

    assert(
        equinoxNoon.altitude > 80 &&
        equinoxNoon.altitude <= 90,
        'Sun is high at equatorial equinox noon'
    );

    assert(
        equinoxMidnight.altitude < -80 &&
        equinoxMidnight.altitude >= -90,
        'Sun is below the horizon at equatorial midnight'
    );

    assert(
        Number.isFinite(equinoxNoon.azimuth) &&
        equinoxNoon.azimuth >= 0 &&
        equinoxNoon.azimuth < 360,
        'Azimuth is normalized to 0–360 degrees'
    );

    const summerNoon = calculateSolarPosition(
        new Date('2026-06-21T12:00:00Z'),
        65,
        0
    );

    const winterNoon = calculateSolarPosition(
        new Date('2026-12-21T12:00:00Z'),
        65,
        0
    );

    assert(
        summerNoon.altitude > winterNoon.altitude + 20,
        'Solar altitude varies by season at high latitude'
    );
}

function testNearestFrame() {
    const sun = { altitude: 0, azimuth: 0 };
    const anchors = [
        { image: 'frame-a', altitude: 0, azimuth: 0 },
        { image: 'frame-b', altitude: 0, azimuth: 5 },
    ];

    const decision = selectSolarFrame(sun, anchors);

    assert(
        decision.selectedAnchor.image === 'frame-a',
        'Nearest solar anchor is selected'
    );

    assert(
        decision.hysteresisAction === 'none',
        'No hysteresis is needed during initial selection'
    );
}

function testHysteresisHold() {
    const sun = { altitude: 0, azimuth: 0 };
    const anchors = [
        { image: 'frame-a', altitude: 0, azimuth: 0 },
        { image: 'frame-b', altitude: 0, azimuth: 0.4 },
    ];

    const decision = selectSolarFrame(
        sun,
        anchors,
        'frame-b',
        0.5
    );

    assert(
        decision.nearestAnchor.image === 'frame-a',
        'Candidate frame is geometrically nearer'
    );

    assertNear(
        decision.distanceAdvantage,
        0.4,
        0.01,
        'Distance advantage is measured in degrees'
    );

    assert(
        decision.selectedAnchor.image === 'frame-b' &&
        decision.hysteresisAction === 'hold',
        'Current frame is retained when advantage is below threshold'
    );
}

function testHysteresisSwitch() {
    const sun = { altitude: 0, azimuth: 0 };
    const anchors = [
        { image: 'frame-a', altitude: 0, azimuth: 0 },
        { image: 'frame-b', altitude: 0, azimuth: 0.8 },
    ];

    const decision = selectSolarFrame(
        sun,
        anchors,
        'frame-b',
        0.5
    );

    assert(
        decision.selectedAnchor.image === 'frame-a' &&
        decision.hysteresisAction === 'switch',
        'Frame switches when the advantage exceeds the threshold'
    );
}

function testAzimuthWraparound() {
    const sun = { altitude: 0, azimuth: 359.9 };
    const anchors = [
        { image: 'near-zero', altitude: 0, azimuth: 0.1 },
        { image: 'west', altitude: 0, azimuth: 358.5 },
    ];

    const decision = selectSolarFrame(sun, anchors);

    assert(
        decision.selectedAnchor.image === 'near-zero',
        'Azimuth comparison correctly wraps around 0/360 degrees'
    );
}

testSolarCoordinates();
testNearestFrame();
testHysteresisHold();
testHysteresisSwitch();
testAzimuthWraparound();

print('\nAll Solar tests passed.');

/**
 * Viridis color map implementation.
 * Converts a value t between 0 and 1 to an RGB color triplet [r, g, b],
 * where r, g, b are integers between 0 and 255.
 * 
 * Based on the reference implementation:
 * https://github.com/BIDS/colormap/blob/master/colormaps.py#L1125-L1143
 * 
 * @param t Input value between 0 and 1.
 * @returns [r, g, b] color array.
 */
export function getViridisColor(t: number): [number, number, number] {
    // Clamp t to the range [0, 1]
    t = Math.max(0, Math.min(1, t));

    // These coefficients are derived from the original matplotlib implementation
    const r = Math.round(255 * (
        + 0.28026800 + t * (
        + 0.14353300 + t * (
        + 2.22579400 + t * (
        - 11.83966900 + t * (
        + 18.64614200 + t * (
        - 13.03116600 + t * (
        + 3.10311600
    ))))))));
    
    const g = Math.round(255 * (
        + 0.00196400 + t * (
        + 1.86713000 + t * (
        - 3.01848200 + t * (
        + 2.91884900 + t * (
        - 1.30493200 + t * (
        + 0.15578300
    )))))));

    const b = Math.round(255 * (
        + 0.25039600 + t * (
        + 2.52551000 + t * (
        - 7.81584600 + t * (
        + 11.33344400 + t * (
        - 9.90807600 + t * (
        + 4.16786800 + t * (
        - 0.65193700
    ))))))));

    // Clamp RGB values to [0, 255] just in case
    return [
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b))
    ];
}

// Example: You could add other colormaps here (e.g., Magma, Plasma, Inferno)
// export function getMagmaColor(t: number): [number, number, number] { ... } 
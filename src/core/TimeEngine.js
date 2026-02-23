export function createTimeEngine({
  topAge,
  baseAge,
  orientation,
  width,
  height
}) {
  function ageToPosition(age) {
    const ratio = (age - topAge) / (baseAge - topAge);

    if (orientation === "vertical") {
      return ratio * height;
    } else {
      // Oldest on left
      return width - ratio * width;
    }
  }

  function getAxisPosition() {
    return orientation === "vertical"
      ? width / 2
      : height / 2;
  }

  return {
    ageToPosition,
    getAxisPosition
  };
}

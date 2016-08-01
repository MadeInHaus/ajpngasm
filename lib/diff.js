module.exports = function slicer(currPNG, prevPNG, options) {

    var thresholdValues = options.slicerThreshold || 0;
    var thresholdPixelsPerRowCol = options.slicerThresholdPixelsPerRowCol || 0;

    var marginBounds = {};
    marginBounds.x = options.slicerMarginLeft || 0;
    marginBounds.y = options.slicerMarginTop || 0;
    marginBounds.width = (currPNG.width - (options.slicerMarginRight || 0)) - marginBounds.x;
    marginBounds.height = (currPNG.height - (options.slicerMarginBottom || 0)) - marginBounds.y;

    function compareRGBA(i) {
        return Math.abs(+currPNG.data[i]     - +prevPNG.data[i])     > thresholdValues ||
               Math.abs(+currPNG.data[i + 1] - +prevPNG.data[i + 1]) > thresholdValues || 
               Math.abs(+currPNG.data[i + 2] - +prevPNG.data[i + 2]) > thresholdValues || 
               Math.abs(+currPNG.data[i + 3] - +prevPNG.data[i + 3]) > thresholdValues;
    }

    function compareRow(nr) {
        var offs = nr * currPNG.width * 4;
        var iStart = marginBounds.x * 4;
        var iStop = (marginBounds.x + marginBounds.width) * 4;
        var diffCount = 0;
        for (var i = iStart; i < iStop; i += 4) {
            var idx = i + offs;
            if (prevPNG ? compareRGBA(idx) : +currPNG.data[idx + 3] > thresholdValues) {
                if (++diffCount > thresholdPixelsPerRowCol) {
                    return false;
                }
            }
        }
        return true;
    }

    function compareColumn(nr) {
        var rowLen = currPNG.width * 4;
        var offs = nr * 4;
        var iStart = marginBounds.y;
        var iStop = marginBounds.y + marginBounds.height;
        var diffCount = 0;
        for (var i = iStart; i < iStop; i++) {
            var idx = i * rowLen + offs;
            if (prevPNG ? compareRGBA(idx) : +currPNG.data[idx + 3] > thresholdValues) {
                if (++diffCount > thresholdPixelsPerRowCol) {
                    return false;
                }
            }
        }
        return true;
    }

    var rows = [];
    var columns = [];
    for (var i = marginBounds.x; i < marginBounds.x + marginBounds.width; i++) {
        columns[i] = compareColumn(i) ? 1 : 0;
    }
    for (var i = marginBounds.y; i < marginBounds.y + marginBounds.height; i++) {
        rows[i] = compareRow(i) ? 1 : 0;
    }

    var x1 = columns.indexOf(0);
    var x2 = columns.lastIndexOf(0);
    var y1 = rows.indexOf(0);
    var y2 = rows.lastIndexOf(0);
    if (x1 !== -1 || x2 !== -1 && y1 !== -1 || y2 !== -1) {
        if (x1 == -1) { x1 = 0; }
        if (y1 == -1) { y1 = 0; }
        x2 = (x2 === -1) ? currPNG.width : x2 + 1;
        y2 = (y2 === -1) ? currPNG.height : y2 + 1;
        result = {
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
        };
    } else {
        result = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            isEmpty: true,
        };
    }
    
    return result;
}

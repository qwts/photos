// Overlook DS loader: uses the compiled _ds_bundle.js namespace when present,
// otherwise builds window.DS by transpiling the component sources directly.
// Include AFTER react + babel-standalone, with data-root pointing at the project root.
(function () {
  function has(ns) { return ns && typeof ns === "object" && ns.Button && ns.PhotoTile; }
  try {
    var existing = Object.keys(window).map(function (k) { try { return window[k]; } catch (e) { return null; } }).find(has);
    if (existing) { window.DS = existing; return; }
  } catch (e) { /* fall through */ }
  var root = (document.currentScript && document.currentScript.getAttribute("data-root")) || ".";
  var files = [
    "core/Icon", "core/Button", "core/IconButton", "core/Badge", "core/Tooltip", "core/TitleBar",
    "forms/SearchField", "forms/Chip", "forms/Switch", "forms/Checkbox", "forms/Slider", "forms/Segmented",
    "feedback/Dialog", "feedback/Toast", "feedback/ProgressBar",
    "media/StatusGlyph", "media/PhotoTile", "media/MetadataRow",
  ];
  var names = files.map(function (f) { return f.split("/")[1]; });
  var src = "var React = window.React;\nvar " + names.join(", ") + ";\n";
  files.forEach(function (f, i) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", root + "/components/" + f + ".jsx", false);
    xhr.send();
    var body = xhr.responseText.replace(/^import .*$/gm, "").replace(/^export function/gm, "function");
    src += names[i] + " = (function () {\n" + body + "\nreturn " + names[i] + ";\n})();\n";
  });
  src += "\nwindow.DS = {" + names.join(",") + "};";
  // eslint-disable-next-line no-eval
  eval(Babel.transform(src, { presets: [["react", { runtime: "classic", pragma: "React.createElement" }]] }).code);
})();

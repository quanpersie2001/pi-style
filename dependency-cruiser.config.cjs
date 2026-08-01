/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "shared-no-upper-layers",
      comment: "shared/ must not depend on domain, features, app, or pi",
      severity: "error",
      from: { path: "^extension-src/pi-style/shared/" },
      to: { path: "^(extension-src/pi-style/domain/|extension-src/pi-style/features/|extension-src/pi-style/app/|extension-src/pi-style/pi/)" },
    },
    {
      name: "domain-no-upper-layers",
      comment: "domain/ must not depend on features, app, or pi",
      severity: "error",
      from: { path: "^extension-src/pi-style/domain/" },
      to: { path: "^(extension-src/pi-style/features/|extension-src/pi-style/app/|extension-src/pi-style/pi/)" },
    },
    {
      name: "features-no-upper-layers",
      comment: "features/ must not depend on app or pi",
      severity: "error",
      from: { path: "^extension-src/pi-style/features/" },
      to: { path: "^(extension-src/pi-style/app/|extension-src/pi-style/pi/)" },
    },
    {
      name: "features-no-sibling-features",
      comment: "feature modules must not depend on sibling features; app/ composes features",
      severity: "error",
      from: { path: "^extension-src/pi-style/features/" },
      to: { path: "^extension-src/pi-style/features/" },
    },
    {
      name: "app-no-pi",
      comment: "app/ must not depend on pi/",
      severity: "error",
      from: { path: "^extension-src/pi-style/app/" },
      to: { path: "^extension-src/pi-style/pi/" },
    },
    {
      name: "no-cross-layer-skips",
      comment: "Only pi/ may skip layers. All other layers follow the strict chain.",
      severity: "error",
      from: { path: "^(extension-src/pi-style/shared/|extension-src/pi-style/domain/|extension-src/pi-style/features/|extension-src/pi-style/app/)" },
      to: { path: "^extension-src/pi-style/pi/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default"],
    },
  },
};

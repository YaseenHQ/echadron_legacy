{
  description = "Echadron multi-provider agent harness";

  inputs = {
    # Pinned to the 25.11 release channel because nixpkgs-unstable currently
    # ships nodejs_24 = 24.14.1, which trips the >= 24.15.0 floor that the
    # native SEA build enforces (see apps/echadron/scripts/native/build.mjs).
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (import nixpkgs {
            inherit system;
          })
        );

      minNodeVersion = "24.15.0";

      # Hardcode to Node.js 24.x; fail the evaluation if the pinned nixpkgs
      # does not offer a new enough 24.x.
      nodejsFor =
        pkgs:
        let
          node = pkgs.nodejs_24;
        in
        if lib.versionAtLeast node.version minNodeVersion then
          node
        else
          throw ''
            Kimi Code requires Node.js >= ${minNodeVersion},
            but nixpkgs only offers ${node.version}.
            Pin a newer nixpkgs revision or update minNodeVersion in flake.nix.
          '';

      pnpmFor =
        pkgs:
        pkgs.pnpm_10.override {
          nodejs = nodejsFor pkgs;
        };

      # -------------------------------------------------------------------
      # Workspace members (kept in sync with pnpm-workspace.yaml).
      #
      # HARD REQUIREMENT: whenever you add or remove a workspace package,
      # you MUST update both lists below. Missing a path will break the Nix
      # build (src fileset silently drops files); missing a name will break
      # pnpmConfigHook (dependencies for that workspace won't be fetched).
      # -------------------------------------------------------------------
      workspacePaths = [
        ./packages/acp-adapter
        ./packages/acp-server
        ./packages/agent-core
        ./packages/agent-core-v2
        ./packages/kap-server
        ./packages/kaos
        ./packages/klient
        ./packages/tsugite
        ./packages/migration-legacy
        ./packages/minidb
        ./packages/node-sdk
        ./packages/oauth
        ./packages/pi-tui
        ./packages/protocol
        ./packages/telemetry
        ./packages/transcript
        ./packages/tree-sitter-bash
        ./apps/echadron
        ./apps/vscode
        ./apps/echadron-inspect
        ./apps/echadron-web
        ./apps/vis
        ./apps/vis/server
        ./apps/vis/web
        ./docs
      ];

      workspaceNames = [
        "@yaseenhq/acp-adapter"
        "@yaseenhq/acp-server"
        "@yaseenhq/agent-core"
        "@yaseenhq/agent-core-v2"
        "@yaseenhq/kap-server"
        "@yaseenhq/kaos"
        "@yaseenhq/tsugite"
        "@yaseenhq/migration-legacy"
        "@yaseenhq/minidb"
        "@yaseenhq/echadron-sdk"
        "@yaseenhq/echadron-oauth"
        "@yaseenhq/klient"
        "@yaseenhq/pi-tui"
        "@yaseenhq/protocol"
        "@yaseenhq/echadron-telemetry"
        "@yaseenhq/transcript"
        "@yaseenhq/tree-sitter-bash"
        "echadron"
        "echadron-code"
        "@yaseenhq/echadron-inspect"
        "@yaseenhq/echadron-web"
        "@yaseenhq/vis"
        "@yaseenhq/vis-server"
        "@yaseenhq/vis-web"
        "echadron-docs"
      ];
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          nodejs = nodejsFor pkgs;
          pnpm = pnpmFor pkgs;
          appPackageJson = builtins.fromJSON (builtins.readFile ./apps/echadron/package.json);
          nativeTarget =
            if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isAarch64 then
              "linux-arm64"
            else if pkgs.stdenv.hostPlatform.isLinux then
              "linux-x64"
            else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
              "darwin-arm64"
            else if pkgs.stdenv.hostPlatform.isDarwin then
              "darwin-x64"
            else
              throw "Unsupported Echadron native target for ${pkgs.stdenv.hostPlatform.system}";

          echadron = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "echadron";
            version = appPackageJson.version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./build
                  ./.npmrc
                  ./.nvmrc
                  ./package.json
                  ./pnpm-lock.yaml
                  ./pnpm-workspace.yaml
                  ./tsconfig.json
                  ./vitest.config.ts
                  ./LICENSE
                ]
                ++ workspacePaths
              );
            };

            pnpmWorkspaces = [ "." ] ++ workspaceNames;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-k8hb4Xvtv4dsmkP3SNzgwiMcsDx2yS926uLwCxMqqtw=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              (pkgs.pnpmConfigHook.override { inherit pnpm; })
              pkgs.makeWrapper
            ]
            # The SEA inject step (postject) invalidates the macOS code
            # signature on the copied Node executable; build.mjs then re-applies
            # an ad-hoc signature via `codesign`. The Nix darwin sandbox does
            # not expose /usr/bin/codesign, so we supply nixpkgs' ad-hoc-only
            # replacement instead.
            ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
              pkgs.darwin.sigtool
            ];

            # The SEA binary is produced by `postject`-injecting a blob into a
            # plain Node executable. Stripping rewrites section tables and can
            # invalidate the injected blob's offsets, so leave the binary
            # untouched after the build.
            dontStrip = true;

            buildPhase = ''
              runHook preBuild
              export KIMI_CODE_BUILD_TARGET=${nativeTarget}
              ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                # pkgs.darwin.sigtool's codesign supports `--sign -` (ad-hoc)
                # but not the inspection mode (`-dv`) that 05-verify.mjs runs
                # afterwards. Disable the verify step for the Nix build; the
                # release CI keeps it via the unmodified script.
                substituteInPlace apps/echadron/scripts/native/build.mjs \
                  --replace-fail \
                    "await runVerifyStep({ requireGatekeeper: false });" \
                    "// runVerifyStep skipped in nix sandbox (sigtool lacks -dv)"
              ''}
              # The SEA blob step (scripts/native/02-sea-blob.mjs) embeds the
              # Echadron web assets from apps/echadron/dist-web and fails if that
              # directory is missing. Build the web app and stage its assets
              # before producing the native executable.
              pnpm --filter=@yaseenhq/echadron-web run build
              node apps/echadron/scripts/copy-web-assets.mjs
              pnpm --filter=echadron run build:native:sea
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 \
                "apps/echadron/dist-native/bin/${nativeTarget}/echadron" \
                "$out/bin/echadron"

              runHook postInstall
            '';

            postInstall = ''
              wrapProgram $out/bin/echadron --prefix PATH : ${lib.makeBinPath [ pkgs.ripgrep pkgs.fd ]}
            '';

            meta = {
              description = "Echadron multi-provider agent harness";
              homepage = "https://github.com/YaseenHQ/echadron";
              license = lib.licenses.mit;
              mainProgram = "echadron";
              platforms = systems;
            };
          });
        in
        {
          inherit echadron;
          default = echadron;
        }
      );

      apps = forAllSystems (pkgs: {
        echadron = {
          type = "app";
          program = "${self.packages.${pkgs.system}.echadron}/bin/echadron";
        };
        default = self.apps.${pkgs.system}.echadron;
      });

      devShells = forAllSystems (pkgs: {
        default =
          let
            nodejs = nodejsFor pkgs;
            pnpm = pnpmFor pkgs;
          in
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.ripgrep
              pkgs.fd
            ];
          };
      });
    };
}

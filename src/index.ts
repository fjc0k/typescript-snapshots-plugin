import * as ts_module from "typescript/lib/tsserverlibrary";
import { defaultConfig } from "./config";
import { SnapshotCache } from "./snapshotcache";
import { tryGetSnapshotForPosition, getSnapshotPathForFileName } from "./getsnapshot";


function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;
    const snapshotCache = new SnapshotCache(ts);


    /**
     * Create TS plugin
     */
    function create(info: ts.server.PluginCreateInfo) {
        const proxy = Object.create(null) as ts.LanguageService;
        const oldLS = info.languageService;
        const snapshotCallIdentifiers: string[] = info.config.snapshotCallIdentifiers || defaultConfig.snapshotCallIdentifies;
        const testBlockIdentifiers: string[] = info.config.testBlockIdentifiers || defaultConfig.testBlockIdentifiers;

        for (const k in oldLS) {
            (proxy as any)[k] = function () {
                return oldLS[k as keyof ts.LanguageService].apply(oldLS, arguments);
            }
        }

        /**
         * Hover
         */
        proxy.getQuickInfoAtPosition = (fileName, position) => {
            const originalQuickInfo = oldLS.getQuickInfoAtPosition(fileName, position);
            const sourceFile = oldLS.getProgram().getSourceFile(fileName);
            const snapshotDef = tryGetSnapshotForPosition(ts, sourceFile, position, snapshotCache, snapshotCallIdentifiers, testBlockIdentifiers);
            if (snapshotDef) {
                originalQuickInfo.displayParts.push({
                    kind: "method",
                    text: "\n" + snapshotDef.snapshot
                });
            }
            return originalQuickInfo;
        }

        /**
         * Go to definition
         */
        proxy.getDefinitionAtPosition = (fileName, position) => {
            const prior = oldLS.getDefinitionAtPosition(fileName, position);
            const sourceFile = oldLS.getProgram().getSourceFile(fileName);
            const snapshotDef = tryGetSnapshotForPosition(ts, sourceFile, position, snapshotCache, snapshotCallIdentifiers, testBlockIdentifiers);
            if (snapshotDef) {
                prior.unshift({
                    fileName: getSnapshotPathForFileName(fileName),
                    name: snapshotDef.name,
                    containerName: "Snapshots",
                    containerKind: ts.ScriptElementKind.variableElement,
                    textSpan: {
                        start: snapshotDef.position,
                        length: snapshotDef.length
                    },
                    kind: ts.ScriptElementKind.variableElement
                });
            }

            return prior;
        }


        return proxy;
    }

    function getExternalFiles(project: ts_module.server.Project): string[] {
        // Return snapshot file for each opened file, seems enough for our needs
        const openFiles = project.projectService.openFiles.map(f => f.fileName).filter(f => !f.endsWith(".snap"));
        const externalFiles = openFiles.map(getSnapshotPathForFileName).filter(f => project.projectService.host.fileExists(f));
        return externalFiles;
    }

    return { create, getExternalFiles };
}
export = init;
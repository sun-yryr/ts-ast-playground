import { Args, Command, Flags } from "@oclif/core";
import {
  Project,
  type SourceFile,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";

export default class Csf3Morph extends Command {
  static override args = {
    fileGlob: Args.string({ description: "file glob to read", required: true }),
  };

  static override description =
    "storybookのマイグレーションで出てきたCSF3に型定義を追加する";

  static override examples = [
    '$ csf3-morph --tsConfigPath="tsconfig.json" "packages/ui/stories/**/*.tsx"',
  ];

  static override flags = {
    tsConfigPath: Flags.string({
      description: "tsconfig.json path",
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Csf3Morph);
    const { fileGlob } = args;
    const { tsConfigPath } = flags;

    const project = new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: true,
    });
    project.addSourceFilesAtPaths(fileGlob);
    // 各ファイルに対して変換を適用
    for (const sourceFile of project.getSourceFiles()) {
      console.log("convert", sourceFile.getFilePath());
      transformSourceFile(sourceFile);
    }
    // 変換後のコードをファイルに書き戻す
    project.saveSync();
  }
}

export function transformSourceFile(sourceFile: SourceFile) {
  if (sourceFile.getExportAssignments().length !== 1) {
    console.log("複数の default export があるため、変換をスキップします。");
    console.log("csf3-morph-2 を試してみてください。");
    return;
  }
  // Meta, StoryObj のインポートを追加
  const importDeclaration = sourceFile.getImportDeclaration(
    (declaration) =>
      declaration.getModuleSpecifierValue() === "@storybook/react",
  );

  if (!importDeclaration) {
    sourceFile.addImportDeclaration({
      namedImports: ["Meta", "StoryObj"],
      moduleSpecifier: "@storybook/react",
    });
  } else {
    const namedImports = importDeclaration
      .getNamedImports()
      .map((ni) => ni.getName());
    if (!namedImports.includes("Meta")) {
      importDeclaration.addNamedImport("Meta");
    }
    if (!namedImports.includes("StoryObj")) {
      importDeclaration.addNamedImport("StoryObj");
    }
  }

  // export default の変換
  const defaultExport = sourceFile.getExportAssignment(
    (node) => !node.isExportEquals(),
  );
  const defaultExpr = defaultExport?.getExpression();
  if (defaultExport && defaultExpr && defaultExpr.getText() !== "meta") {
    const defaultExportIndex = defaultExport.getChildIndex();

    sourceFile.insertVariableStatement(defaultExportIndex, {
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: "meta",
          initializer: `${defaultExpr.getText()} satisfies Meta`,
        },
      ],
    });

    defaultExpr.replaceWithText("meta");
  }

  // export const の型パラメータ��加
  const exportConsts = sourceFile
    .getVariableStatements()
    .filter((statement) => statement.isExported());
  for (const statement of exportConsts) {
    for (const declaration of statement.getDeclarations()) {
      const type = declaration.getTypeNode();
      if (type == null) {
        declaration.setType("StoryObj<typeof meta>");
      }
      // declaration が function の場合、{ render: function } となるような変換を行う
      if (
        declaration.getInitializer()?.getKind() ===
          SyntaxKind.FunctionExpression ||
        declaration.getInitializer()?.getKind() === SyntaxKind.ArrowFunction
      ) {
        const functionName = declaration.getName();
        const functionInitializer = declaration.getInitializer()?.getText();
        declaration.setInitializer(`{ render: ${functionInitializer} }`);
      }
    }
  }
}

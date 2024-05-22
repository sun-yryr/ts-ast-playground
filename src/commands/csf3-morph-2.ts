import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Args, Command, Flags } from "@oclif/core";
import {
  type ExportAssignment,
  ObjectLiteralExpression,
  Project,
  PropertyAssignment,
  type SourceFile,
  type Statement,
} from "ts-morph";

export default class Csf3Morph2 extends Command {
  static override args = {
    fileGlob: Args.string({ description: "file glob to read", required: true }),
  };

  static override description = `storybookのマイグレーションで出てきたCSF3をパースする その2。
  複数の default export を持つ CSF3 ファイルを title に沿ったファイルに分割する。`;

  static override examples = [];

  static override flags = {
    tsConfigPath: Flags.string({
      description: "tsconfig.json path",
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Csf3Morph2);
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
  const importStatements: Statement[] = [];
  const localStatements: Statement[] = [];
  const stories: { default: ExportAssignment; named: Statement[] }[] = [];

  // インポート文の収集
  for (const importDecl of sourceFile.getImportDeclarations()) {
    importStatements.push(importDecl);
  }

  // ローカル変数の収集
  for (const varStmt of sourceFile.getVariableStatements()) {
    if (!varStmt.isExported()) {
      localStatements.push(varStmt);
    }
  }

  // default export と named export の収集
  // default export の index を集める
  const defaultExportItems: { index: number; assignment: ExportAssignment }[] =
    [];
  const defaultExports = sourceFile.getExportAssignments();
  for (const defaultExport of defaultExports) {
    defaultExportItems.push({
      index: defaultExport.getChildIndex(),
      assignment: defaultExport,
    });
  }

  for (let i = 0; i < defaultExportItems.length - 1; i++) {
    const startIndex = defaultExportItems[i].index;
    const endIndex = defaultExportItems[i + 1].index;
    const statements = sourceFile.getStatements().slice(startIndex, endIndex);
    stories.push({
      default: defaultExportItems[i].assignment,
      named: statements,
    });
  }
  // 最後のdefault export から最後までのstatementを取得
  const statements = sourceFile
    .getStatements()
    .slice(defaultExportItems[defaultExportItems.length - 1].index);
  stories.push({
    default: defaultExportItems[defaultExportItems.length - 1].assignment,
    named: statements,
  });

  // 例: 収集したインポート文を出力
  console.log("importStatements", importStatements.length);
  // 例: 収集したローカル変数を出力
  console.log("localStatements", localStatements.length);
  // 例: 収集したストーリーを出力
  console.log("stories", stories.length);
  for (const story of stories) {
    console.log("stories.default.children", story.named.length);
  }

  // 変換
  const basePath = sourceFile.getDirectoryPath();
  const baseFileName = sourceFile.getBaseName().split(".")[0];
  const storyDirPath = path.join(basePath, baseFileName);
  console.log(storyDirPath);
  for (const story of stories) {
    console.log("");
    // story.default の title を取得する
    const expression = story.default.getExpression();
    if (!(expression instanceof ObjectLiteralExpression)) {
      continue;
    }
    const property = expression.getProperty("title");
    if (!(property instanceof PropertyAssignment)) {
      console.log("continue: no property");
      continue;
    }
    const title = property.getInitializer()?.getText();
    console.log(title);
    if (!title) {
      console.log("continue: no title");
      continue;
    }
    const titleParts = title.split("/").slice(1);
    if (titleParts.length === 0) {
      titleParts.push(title.replaceAll(" ", "_"));
    }
    const fileNameParts = titleParts.map((part) =>
      part.replaceAll(" ", "_").replaceAll("'", ""),
    );
    const storyPath = `${path.join(storyDirPath, ...fileNameParts)}.tsx`;
    console.log(storyPath);

    // 書き込み
    mkdirSync(path.dirname(storyPath), { recursive: true });
    // ファイルを書き込む (追加書き込み)
    appendFileSync(
      storyPath,
      importStatements.map((statement) => statement.getText()).join("\n"),
    );
    appendFileSync(storyPath, "\n\n");
    appendFileSync(
      storyPath,
      localStatements.map((statement) => statement.getText()).join("\n"),
    );
    appendFileSync(storyPath, "\n\n");
    appendFileSync(
      storyPath,
      story.named.map((statement) => statement.getText()).join("\n"),
    );
    appendFileSync(storyPath, "\n");
  }
}

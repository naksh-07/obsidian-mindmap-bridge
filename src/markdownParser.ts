export interface MindMapNode {
    id: string;
    label: string;
    subtitle?: string;
    description?: string;
    category?: string;
    badge?: string;
    color?: string;
    icon?: string;
    children?: MindMapNode[];
    tags?: string[];
    keyFacts?: string[];
}

export interface CrossLink {
    sourceId: string;
    targetId: string;
    label?: string;
    type?: "relationship" | "causality" | "comparison";
}

export interface QuizQuestion {
    id: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options: string[];
    correctAnswerIndex: number;
    explanation: string;
}

export interface MindMapData {
    id: string;
    title: string;
    subtitle?: string;
    subject: string;
    chapter?: string;
    language: "hi" | "en" | "mixed";
    root: MindMapNode;
    crossLinks?: CrossLink[];
    quizQuestions?: QuizQuestion[];
}

interface FrontmatterData {
    title?: string;
    subtitle?: string;
    subject?: string;
    chapter?: string;
    language?: "hi" | "en" | "mixed";
    tags?: string[];
}

/**
 * Detects whether text is primarily Hindi (Devanagari), English, or mixed.
 */
export function detectLanguage(text: string): "hi" | "en" | "mixed" {
    const devanagariMatches = text.match(/[\u0900-\u097F]/g);
    const latinMatches = text.match(/[A-Za-z]/g);
    const devCount = devanagariMatches ? devanagariMatches.length : 0;
    const latCount = latinMatches ? latinMatches.length : 0;

    if (devCount === 0 && latCount === 0) return "en";
    if (devCount > 0 && latCount === 0) return "hi";
    if (latCount > 0 && devCount === 0) return "en";

    const ratio = devCount / (devCount + latCount);
    if (ratio >= 0.6) return "hi";
    if (ratio <= 0.15) return "en";
    return "mixed";
}

/**
 * Extracts simple YAML frontmatter block if present at the start of a Markdown string.
 */
function parseFrontmatter(markdown: string): { frontmatter: FrontmatterData; body: string } {
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
    const match = markdown.match(fmRegex);
    if (!match) {
        return { frontmatter: {}, body: markdown };
    }

    const rawYaml = match[1];
    const body = markdown.slice(match[0].length);
    const fm: FrontmatterData = {};

    const lines = rawYaml.split(/\r?\n/);
    for (const line of lines) {
        const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
        if (!kvMatch) continue;
        const key = kvMatch[1].trim().toLowerCase();
        const rawVal = kvMatch[2].trim().replace(/^["']|["']$/g, "");

        if (key === "title" && rawVal) fm.title = rawVal;
        else if (key === "subtitle" && rawVal) fm.subtitle = rawVal;
        else if (key === "subject" && rawVal) fm.subject = rawVal;
        else if (key === "chapter" && rawVal) fm.chapter = rawVal;
        else if (key === "language" && (rawVal === "hi" || rawVal === "en" || rawVal === "mixed")) {
            fm.language = rawVal;
        } else if (key === "tags") {
            const cleaned = rawVal.replace(/^\[|\]$/g, "");
            const tags = cleaned
                .split(/[,\s]+/)
                .map((t) => t.replace(/^#/, "").trim())
                .filter(Boolean);
            if (tags.length > 0) fm.tags = tags;
        }
    }

    return { frontmatter: fm, body };
}

/**
 * Strips Markdown formatting while extracting [[WikiLinks]] and #tags.
 */
function parseInlineMetadata(rawText: string): {
    cleanText: string;
    wikiLinks: { target: string; alias: string }[];
    tags: string[];
} {
    const wikiLinks: { target: string; alias: string }[] = [];
    const tags: string[] = [];

    // Extract [[target|alias]] or [[target]]
    let text = rawText.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
        const cleanTarget = target.trim();
        const cleanAlias = (alias || target).trim();
        wikiLinks.push({ target: cleanTarget, alias: cleanAlias });
        return cleanAlias;
    });

    // Extract inline #tags (ignoring markdown heading hashes)
    text = text.replace(/(?:^|\s)#([A-Za-z0-9_\-\u0900-\u097F/]+)/g, (full, tag: string) => {
        tags.push(tag.trim());
        return full.startsWith(" ") ? " " : "";
    });

    // Clean bold/italic/code markers for display label
    const cleanText = text
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .trim();

    return { cleanText, wikiLinks, tags };
}

/**
 * Generates a unique node ID within the tree.
 * If a WikiLink target is present, prefers that target path so OPEN_NOTE navigates directly to it.
 */
function createUniqueNodeId(
    preferredBase: string,
    fallbackPrefix: string,
    seenIds: Set<string>
): string {
    const sanitized = preferredBase
        .trim()
        .replace(/^#+/, "")
        .replace(/\s+/g, "-")
        .replace(/[^\w\-\u0900-\u097F/.#]/g, "")
        .replace(/^-+|-+$/g, "");

    const baseId = sanitized || fallbackPrefix;
    if (!seenIds.has(baseId)) {
        seenIds.add(baseId);
        return baseId;
    }

    let counter = 2;
    while (seenIds.has(`${baseId}-${counter}`)) {
        counter++;
    }
    const finalId = `${baseId}-${counter}`;
    seenIds.add(finalId);
    return finalId;
}

/**
 * Converts an Obsidian Markdown note into a validated MindMapData JSON structure
 * compatible with MindMap Studio's PixiJS v8 WebGL engine & Stitch Inspector.
 */
export function convertMarkdownToMindMapData(
    markdownContent: string,
    fileBasename: string,
    filePath: string,
    parentFolderName = "Obsidian Vault"
): MindMapData {
    const { frontmatter, body } = parseFrontmatter(markdownContent);
    const seenNodeIds = new Set<string>();
    const pendingCrossLinks: { sourceId: string; targetRef: string }[] = [];

    const docTitle = frontmatter.title || fileBasename || "Untitled Mind Map";
    const docSubject = frontmatter.subject || parentFolderName || "Obsidian Notes";
    const docLanguage = frontmatter.language || detectLanguage(body || docTitle);

    const rootId = createUniqueNodeId(filePath.replace(/\.md$/i, ""), "root-node", seenNodeIds);
    const rootNode: MindMapNode = {
        id: rootId,
        label: docTitle,
        subtitle: frontmatter.subtitle || `Obsidian Note • ${filePath}`,
        category: "root",
        tags: frontmatter.tags ? [...frontmatter.tags] : [],
        keyFacts: [],
        children: [],
    };

    const lines = body.split(/\r?\n/);
    const headingStack: { level: number; node: MindMapNode }[] = [{ level: 0, node: rootNode }];

    let inCodeBlock = false;
    let nodeCounter = 1;
    let h1UsedAsRootTitle = false;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock || !trimmed) continue;

        // 1. Check for Markdown Headings (# to ######)
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const rawHeadingText = headingMatch[2].trim();
            const { cleanText, wikiLinks, tags } = parseInlineMetadata(rawHeadingText);
            const headingLabel = cleanText || rawHeadingText;

            // If first H1 matches document title and root has no children yet, merge into root
            if (
                level === 1 &&
                !h1UsedAsRootTitle &&
                rootNode.children &&
                rootNode.children.length === 0 &&
                (headingLabel.toLowerCase() === docTitle.toLowerCase() || !frontmatter.title)
            ) {
                h1UsedAsRootTitle = true;
                rootNode.label = headingLabel;
                if (tags.length > 0) {
                    rootNode.tags = Array.from(new Set([...(rootNode.tags || []), ...tags]));
                }
                continue;
            }

            // Prefer WikiLink target as node ID if heading links to another note, else file#heading
            const preferredId =
                wikiLinks.length > 0
                    ? wikiLinks[0].target
                    : `${filePath}#${headingLabel}`;
            const nodeId = createUniqueNodeId(preferredId, `section-${nodeCounter++}`, seenNodeIds);

            const newNode: MindMapNode = {
                id: nodeId,
                label: headingLabel,
                category: level <= 2 ? "branch" : "concept",
                tags: tags.length > 0 ? tags : undefined,
                keyFacts: [],
                children: [],
            };

            for (const wl of wikiLinks) {
                pendingCrossLinks.push({ sourceId: nodeId, targetRef: wl.target });
            }

            // Pop stack until parent has strictly lower level
            while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) {
                headingStack.pop();
            }

            const parentNode = headingStack[headingStack.length - 1].node;
            if (!parentNode.children) parentNode.children = [];
            parentNode.children.push(newNode);
            headingStack.push({ level, node: newNode });
            continue;
        }

        const currentActiveNode = headingStack[headingStack.length - 1].node;

        // 2. Check for Bullet / Numbered List Items
        const listMatch = rawLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
        if (listMatch) {
            const indentSpaces = listMatch[1].replace(/\t/g, "  ").length;
            const rawItemText = listMatch[2].trim();
            const { cleanText, wikiLinks, tags } = parseInlineMetadata(rawItemText);
            if (!cleanText) continue;

            if (tags.length > 0) {
                currentActiveNode.tags = Array.from(new Set([...(currentActiveNode.tags || []), ...tags]));
            }
            for (const wl of wikiLinks) {
                pendingCrossLinks.push({ sourceId: currentActiveNode.id, targetRef: wl.target });
            }

            // Bold "Key: Value" or top-level bullets in a headingless note become child nodes
            const kvBulletMatch = rawItemText.match(/^\*\*([^*]+)\*\*\s*[:—-]\s*(.+)$/);
            const isRootWithoutHeadings = currentActiveNode === rootNode && (!rootNode.children || rootNode.children.length === 0 || indentSpaces === 0);

            if (kvBulletMatch && indentSpaces === 0) {
                const termParsed = parseInlineMetadata(kvBulletMatch[1]);
                const descParsed = parseInlineMetadata(kvBulletMatch[2]);
                const preferredId =
                    wikiLinks.length > 0
                        ? wikiLinks[0].target
                        : `${filePath}#${termParsed.cleanText}`;
                const bulletNodeId = createUniqueNodeId(preferredId, `item-${nodeCounter++}`, seenNodeIds);

                const childNode: MindMapNode = {
                    id: bulletNodeId,
                    label: termParsed.cleanText || cleanText,
                    subtitle: descParsed.cleanText.length <= 70 ? descParsed.cleanText : undefined,
                    description: descParsed.cleanText,
                    category: "point",
                    tags: tags.length > 0 ? tags : undefined,
                };
                if (!currentActiveNode.children) currentActiveNode.children = [];
                currentActiveNode.children.push(childNode);
            } else if (isRootWithoutHeadings && indentSpaces === 0) {
                const preferredId =
                    wikiLinks.length > 0
                        ? wikiLinks[0].target
                        : `${filePath}#${cleanText.slice(0, 40)}`;
                const bulletNodeId = createUniqueNodeId(preferredId, `item-${nodeCounter++}`, seenNodeIds);
                const childNode: MindMapNode = {
                    id: bulletNodeId,
                    label: cleanText.length > 64 ? `${cleanText.slice(0, 61)}...` : cleanText,
                    description: cleanText.length > 64 ? cleanText : undefined,
                    category: "point",
                    tags: tags.length > 0 ? tags : undefined,
                };
                if (!rootNode.children) rootNode.children = [];
                rootNode.children.push(childNode);
            } else {
                if (!currentActiveNode.keyFacts) currentActiveNode.keyFacts = [];
                currentActiveNode.keyFacts.push(cleanText);
            }
            continue;
        }

        // 3. Regular Paragraph / Blockquote -> Node description or subtitle
        const cleanLine = parseInlineMetadata(trimmed.replace(/^>\s*/, ""));
        if (!cleanLine.cleanText) continue;

        if (cleanLine.tags.length > 0) {
            currentActiveNode.tags = Array.from(
                new Set([...(currentActiveNode.tags || []), ...cleanLine.tags])
            );
        }
        for (const wl of cleanLine.wikiLinks) {
            pendingCrossLinks.push({ sourceId: currentActiveNode.id, targetRef: wl.target });
        }

        if (!currentActiveNode.description) {
            currentActiveNode.description = cleanLine.cleanText;
            if (!currentActiveNode.subtitle && cleanLine.cleanText.length <= 80) {
                currentActiveNode.subtitle = cleanLine.cleanText;
            }
        } else if (currentActiveNode.description.length < 450) {
            currentActiveNode.description += ` ${cleanLine.cleanText}`;
        }
    }

    // Post-process tree: add badges for keyFacts/children count & clean empty arrays
    const nodeLookupByLabel = new Map<string, string>();
    const cleanTree = (node: MindMapNode) => {
        nodeLookupByLabel.set(node.label.toLowerCase(), node.id);
        nodeLookupByLabel.set(node.id.toLowerCase(), node.id);

        if (node.keyFacts && node.keyFacts.length === 0) {
            delete node.keyFacts;
        }
        if (node.tags && node.tags.length === 0) {
            delete node.tags;
        }
        if (node.children && node.children.length === 0) {
            delete node.children;
        } else if (node.children) {
            if (!node.badge && node !== rootNode) {
                node.badge = `${node.children.length} उप-विषय`;
            }
            node.children.forEach(cleanTree);
        }
    };
    cleanTree(rootNode);

    // Resolve internal CrossLinks that exist inside seenNodeIds
    const crossLinks: CrossLink[] = [];
    const seenPairs = new Set<string>();
    for (const link of pendingCrossLinks) {
        const targetId =
            seenNodeIds.has(link.targetRef)
                ? link.targetRef
                : nodeLookupByLabel.get(link.targetRef.toLowerCase());
        if (targetId && targetId !== link.sourceId && seenNodeIds.has(targetId)) {
            const pairKey = `${link.sourceId}->${targetId}`;
            if (!seenPairs.has(pairKey)) {
                seenPairs.add(pairKey);
                crossLinks.push({
                    sourceId: link.sourceId,
                    targetId,
                    type: "relationship",
                });
            }
        }
    }

    return {
        id: `obsidian-md-${rootId}`,
        title: docTitle,
        subtitle: frontmatter.subtitle || rootNode.subtitle,
        subject: docSubject,
        chapter: frontmatter.chapter,
        language: docLanguage,
        root: rootNode,
        crossLinks: crossLinks.length > 0 ? crossLinks : undefined,
    };
}

/**
 * Recursively finds a MindMapNode by ID inside a MindMapNode tree.
 */
export function findNodeById(root: MindMapNode | undefined | null, targetId: string): MindMapNode | null {
    if (!root || !targetId) return null;
    if (root.id === targetId) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNodeById(child, targetId);
            if (found) return found;
        }
    }
    return null;
}

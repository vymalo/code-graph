# python_parser.py
import ast
import json
import sys
import os

# --- Node Visitor ---
class PythonAstVisitor(ast.NodeVisitor):
    def __init__(self, filepath):
        # Normalize path immediately in constructor for consistency
        self.filepath = filepath.replace('\\', '/')
        self.nodes = []
        self.relationships = []
        self.current_class_name = None
        self.current_class_entity_id = None
        self.current_func_entity_id = None # Can be function or method
        self.module_entity_id = None # Store the module/file entity id

    def _get_location(self, node):
        # ast line numbers are 1-based, columns are 0-based
        if isinstance(node, ast.Module):
            # Module node represents the whole file, return default location
            return {"startLine": 1, "endLine": 1, "startColumn": 0, "endColumn": 0}
        try:
            # Attempt to get standard location attributes
            return {
                "startLine": node.lineno,
                "endLine": getattr(node, 'end_lineno', node.lineno),
                "startColumn": node.col_offset,
                "endColumn": getattr(node, 'end_col_offset', -1)
            }
        except AttributeError:
            # Fallback for nodes that might unexpectedly lack location info
            # print(f"DEBUG: Node type {type(node).__name__} lacks location attributes.", file=sys.stderr) # Optional debug
            return {"startLine": 0, "endLine": 0, "startColumn": 0, "endColumn": 0}

    def _generate_entity_id(self, kind, qualified_name, line_number=None):
        # Simple entity ID generation - can be refined
        # Use lowercase kind for consistency
        # Include line number for kinds prone to name collision within the same file scope
        if kind.lower() in ['pythonvariable', 'pythonparameter'] and line_number is not None:
            unique_qualifier = f"{qualified_name}:{line_number}"
        else:
            unique_qualifier = qualified_name
        return f"{kind.lower()}:{self.filepath}:{unique_qualifier}" # Added closing brace

    def _add_node(self, kind, name, node, parent_id=None, extra_props=None):
         location = self._get_location(node)
         # Generate qualified name based on context (Original simpler logic)
         if kind == 'PythonMethod' and self.current_class_name:
             qualified_name = f"{self.current_class_name}.{name}"
         else:
             qualified_name = name
 
         # Pass line number to entity ID generation for relevant kinds
         entity_id = self._generate_entity_id(kind, qualified_name, location['startLine'])

         node_data = {
             "kind": kind,
             "name": name,
             "filePath": self.filepath, # Use normalized path from constructor
             "entityId": entity_id,
             **location,
             "language": "Python",
             "properties": extra_props or {}
         }
         if parent_id:
             node_data["parentId"] = parent_id

         # Store module entity id when creating the File node
         if kind == 'File':
             self.module_entity_id = entity_id

         self.nodes.append(node_data)
         return entity_id # Return entityId for linking relationships

    def _add_relationship(self, type, source_id, target_id, extra_props=None):
         # Simple entity ID for relationships
         rel_entity_id = f"{type.lower()}:{source_id}:{target_id}"
         self.relationships.append({
             "type": type,
             "sourceId": source_id,
             "targetId": target_id,
             "entityId": rel_entity_id,
             "properties": extra_props or {}
         })

    def visit_FunctionDef(self, node):
        parent_id = None
        kind = 'PythonFunction' # Use specific kind
        if self.current_class_entity_id:
            kind = 'PythonMethod' # Use specific kind
            parent_id = self.current_class_entity_id

        # Store current func/method ID for parameters
        original_parent_func_id = self.current_func_entity_id
        func_entity_id = self._add_node(kind, node.name, node, parent_id=parent_id)
        self.current_func_entity_id = func_entity_id

        # Add relationship from class to method
        if kind == 'PythonMethod' and self.current_class_entity_id:
            self._add_relationship('PYTHON_HAS_METHOD', self.current_class_entity_id, func_entity_id)
        # Add relationship from file/module to function
        elif kind == 'PythonFunction' and self.module_entity_id:
             self._add_relationship('PYTHON_DEFINES_FUNCTION', self.module_entity_id, func_entity_id)


        # Visit arguments (parameters)
        if node.args:
            for arg in node.args.args:
                param_entity_id = self._add_node('PythonParameter', arg.arg, arg, parent_id=func_entity_id)
                self._add_relationship('PYTHON_HAS_PARAMETER', func_entity_id, param_entity_id)
            # Handle *args, **kwargs if needed

        # Visit function body
        self.generic_visit(node)
        # Restore parent func ID
        self.current_func_entity_id = original_parent_func_id


    def visit_AsyncFunctionDef(self, node):
        # Treat async functions similarly to regular functions for now
        self.visit_FunctionDef(node) # Reuse logic, maybe add isAsync property

    def visit_ClassDef(self, node):
        original_class_name = self.current_class_name
        original_class_entity_id = self.current_class_entity_id

        self.current_class_name = node.name
        self.current_class_entity_id = self._add_node('PythonClass', node.name, node)

        # Add relationship from file/module to class
        if self.module_entity_id:
             self._add_relationship('PYTHON_DEFINES_CLASS', self.module_entity_id, self.current_class_entity_id)

        # Visit class body (methods, nested classes, etc.)
        self.generic_visit(node)

        self.current_class_name = original_class_name
        self.current_class_entity_id = original_class_entity_id

    def visit_Import(self, node):
        for alias in node.names:
            # Simple import relationship (Module -> Module Name)
            # More complex resolution (finding the actual file) is deferred
            target_name = alias.name
            target_entity_id = self._generate_entity_id('pythonmodule', target_name) # Placeholder ID for module
            # Use the stored module/file entityId as source
            # Explicitly create the target module node (placeholder)
            self._add_node('PythonModule', target_name, node) # Use import node for location approximation
            if self.module_entity_id:
                self._add_relationship('PYTHON_IMPORTS', self.module_entity_id, target_entity_id, {"importedName": alias.asname or alias.name})

    def visit_ImportFrom(self, node):
        module_name = node.module or '.' # Handle relative imports
        # Placeholder ID for the imported module
        target_module_entity_id = self._generate_entity_id('pythonmodule', module_name)
        # Explicitly create the target module node (placeholder)
        self._add_node('PythonModule', module_name, node) # Use import node for location approximation
        # Use the stored module/file entityId as source
        if self.module_entity_id:
            imported_names = []
            for alias in node.names:
                imported_names.append(alias.asname or alias.name)
                # Could potentially create relationships for specific imported items later

            self._add_relationship('PYTHON_IMPORTS', self.module_entity_id, target_module_entity_id, {"importedNames": imported_names, "fromModule": module_name})

    def visit_Assign(self, node):
         # Basic variable assignment detection
         # More complex assignments (tuples, etc.) require more logic
         for target in node.targets:
             if isinstance(target, ast.Name):
                 # Determine parent scope (function, method, class, or module)
                 parent_scope_id = self.current_func_entity_id or self.current_class_entity_id or self.module_entity_id
                 if parent_scope_id: # Ensure parent scope exists
                    self._add_node('PythonVariable', target.id, node, parent_id=parent_scope_id)
         self.generic_visit(node) # Visit the value being assigned

    def visit_Call(self, node):
        # Basic call detection
        func_name = None
        if isinstance(node.func, ast.Name): # Direct function call like my_func()
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute): # Method call like obj.method() or Class.method()
            # Try to reconstruct the full call name (e.g., 'self.method', 'ClassName.static_method')
            # This is complex and requires symbol resolution beyond basic AST walking
            # For now, just use the attribute name
            func_name = node.func.attr

        # Capture calls from module level as well
        source_entity_id = self.current_func_entity_id or self.module_entity_id

        if func_name and source_entity_id:
            # Target ID is tricky without resolution - use a placeholder based on name
            # Use 'pythonfunction' as a placeholder kind instead of 'unknown'
            target_entity_id = self._generate_entity_id('pythonfunction', func_name)
            self._add_relationship('PYTHON_CALLS', source_entity_id, target_entity_id, {"calledName": func_name})

        self.generic_visit(node) # Visit arguments

# --- Main Execution ---
if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "File path argument required."}), file=sys.stderr)
        sys.exit(1)

    filepath_arg = sys.argv[1]
    # Normalize the path within Python using os.path.abspath
    filepath = os.path.abspath(filepath_arg)
    # print(f"DEBUG: Received path: '{filepath_arg}', Absolute path: '{filepath}'", file=sys.stderr) # Keep debug if needed

    if not os.path.exists(filepath):
         print(json.dumps({"error": f"File not found (checked absolute path): {filepath}"}), file=sys.stderr)
         sys.exit(1)

    try:
        # Use the normalized, absolute path
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        tree = ast.parse(content, filename=filepath)

        # Pass the normalized, absolute path to the visitor
        visitor = PythonAstVisitor(filepath)
        # Add the File node itself using the correct kind
        visitor._add_node('File', os.path.basename(filepath), tree) # Use 'File' kind
        visitor.visit(tree)

        result = {
            "filePath": visitor.filepath, # Already normalized in visitor
            "nodes": visitor.nodes,
            "relationships": visitor.relationships
        }
        print(json.dumps(result, indent=2)) # Output JSON to stdout

    except Exception as e:
        # Use the normalized, absolute path in the error message
        print(json.dumps({"error": f"Error parsing {filepath}: {str(e)}"}), file=sys.stderr)
        sys.exit(1)
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  Contents, Kernel, ServiceManager
} from '@jupyterlab/services';

import {
  IIterator, IIterable, each, map
} from 'phosphor/lib/algorithm/iteration';

import {
  find, findIndex, indexOf
} from 'phosphor/lib/algorithm/searching';

import {
  Vector
} from 'phosphor/lib/collections/vector';

import {
  IDisposable, DisposableDelegate
} from 'phosphor/lib/core/disposable';

import {
  ISignal, defineSignal
} from 'phosphor/lib/core/signaling';

import {
  Token
} from 'phosphor/lib/core/token';

import {
  Widget
} from 'phosphor/lib/ui/widget';

import {
  IChangedArgs as IChangedArgsGeneric
} from '../common/interfaces';


/* tslint:disable */
/**
 * The document registry token.
 */
export
const IDocumentRegistry = new Token<IDocumentRegistry>('jupyter.services.document-registry');
/* tslint:enable */


/**
 * The interface for a document registry.
 */
export
interface IDocumentRegistry extends DocumentRegistry {}


/**
 * The document registry.
 */
export
class DocumentRegistry {
  /**
   * A signal emitted when the registry has changed.
   */
  readonly changed: ISignal<this, DocumentRegistry.IChangedArgs>;

  /**
   * Get whether the document registry has been disposed.
   */
  get isDisposed(): boolean {
    return this._widgetFactories === null;
  }

  /**
   * Dispose of the resources held by the document registery.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    for (let modelName in this._modelFactories) {
      this._modelFactories[modelName].dispose();
    }
    this._modelFactories = null;
    for (let widgetName in this._widgetFactories) {
      this._widgetFactories[widgetName].dispose();
    }
    this._widgetFactories = null;
    this._fileTypes.clear();
    this._creators.clear();
    for (let widgetName in this._extenders) {
      this._extenders[widgetName].clear();
    }
  }

  /**
   * Add a widget factory to the registry.
   *
   * @param factory - The factory instance to register.
   *
   * @returns A disposable which will unregister the factory.
   *
   * #### Notes
   * If a factory with the given `'displayName'` is already registered,
   * a warning will be logged, and this will be a no-op.
   * If `'*'` is given as a default extension, the factory will be registered
   * as the global default.
   * If an extension or global default is already registered, this factory
   * will override the existing default.
   */
  addWidgetFactory(factory: DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel>): IDisposable {
    let name = factory.name.toLowerCase();
    if (this._widgetFactories[name]) {
      console.warn(`Duplicate registered factory ${name}`);
      return new DisposableDelegate(null);
    }
    this._widgetFactories[name] = factory;
    for (let ext of factory.defaultFor) {
      if (factory.fileExtensions.indexOf(ext) === -1) {
        continue;
      }
      if (ext === '*') {
        this._defaultWidgetFactory = name;
      } else {
        this._defaultWidgetFactories[ext] = name;
      }
    }
    // For convenience, store a mapping of ext -> name
    for (let ext of factory.fileExtensions) {
      if (!this._widgetFactoryExtensions[ext]) {
        this._widgetFactoryExtensions[ext] = new Vector<string>();
      }
      this._widgetFactoryExtensions[ext].pushBack(name);
    }
    this.changed.emit({
      type: 'widgetFactory',
      name,
      change: 'added'
    });
    return new DisposableDelegate(() => {
      delete this._widgetFactories[name];
      if (this._defaultWidgetFactory === name) {
        this._defaultWidgetFactory = '';
      }
      for (let ext of Object.keys(this._defaultWidgetFactories)) {
        if (this._defaultWidgetFactories[ext] === name) {
          delete this._defaultWidgetFactories[ext];
        }
      }
      for (let ext of Object.keys(this._widgetFactoryExtensions)) {
        this._widgetFactoryExtensions[ext].remove(name);
        if (this._widgetFactoryExtensions[ext].length === 0) {
          delete this._widgetFactoryExtensions[ext];
        }
      }
      this.changed.emit({
        type: 'widgetFactory',
        name,
        change: 'removed'
      });
    });
  }

  /**
   * Add a model factory to the registry.
   *
   * @param factory - The factory instance.
   *
   * @returns A disposable which will unregister the factory.
   *
   * #### Notes
   * If a factory with the given `name` is already registered, or
   * the given factory is already registered, a warning will be logged
   * and this will be a no-op.
   */
  addModelFactory(factory: DocumentRegistry.IModelFactory<DocumentRegistry.IModel>): IDisposable {
    let name = factory.name.toLowerCase();
    if (this._modelFactories[name]) {
      console.warn(`Duplicate registered factory ${name}`);
      return new DisposableDelegate(null);
    }
    this._modelFactories[name] = factory;
    this.changed.emit({
      type: 'modelFactory',
      name,
      change: 'added'
    });
    return new DisposableDelegate(() => {
      delete this._modelFactories[name];
      this.changed.emit({
        type: 'modelFactory',
        name,
        change: 'removed'
      });
    });
  }

  /**
   * Add a widget extension to the registry.
   *
   * @param widgetName - The name of the widget factory.
   *
   * @param extension - A widget extension.
   *
   * @returns A disposable which will unregister the extension.
   *
   * #### Notes
   * If the extension is already registered for the given
   * widget name, a warning will be logged and this will be a no-op.
   */
  addWidgetExtension(widgetName: string, extension: DocumentRegistry.IWidgetExtension<Widget, DocumentRegistry.IModel>): IDisposable {
    widgetName = widgetName.toLowerCase();
    if (!(widgetName in this._extenders)) {
      this._extenders[widgetName] = new Vector<DocumentRegistry.IWidgetExtension<Widget, DocumentRegistry.IModel>>();
    }
    let extenders = this._extenders[widgetName];
    let index = indexOf(extenders, extension);
    if (index !== -1) {
      console.warn(`Duplicate registered extension for ${widgetName}`);
      return new DisposableDelegate(null);
    }
    this._extenders[widgetName].pushBack(extension);
    this.changed.emit({
      type: 'widgetExtension',
      name: null,
      change: 'added'
    });
    return new DisposableDelegate(() => {
      this._extenders[widgetName].remove(extension);
      this.changed.emit({
        type: 'widgetExtension',
        name: null,
        change: 'removed'
      });
    });
  }

  /**
   * Add a file type to the document registry.
   *
   * @params fileType - The file type object to register.
   *
   * @returns A disposable which will unregister the command.
   *
   * #### Notes
   * These are used to populate the "Create New" dialog.
   */
  addFileType(fileType: DocumentRegistry.IFileType): IDisposable {
    this._fileTypes.pushBack(fileType);
    this.changed.emit({
      type: 'fileType',
      name: fileType.name,
      change: 'added'
    });
    return new DisposableDelegate(() => {
      this._fileTypes.remove(fileType);
      this.changed.emit({
        type: 'fileType',
        name: fileType.name,
        change: 'removed'
      });
    });
  }

  /**
   * Add a creator to the registry.
   *
   * @params creator - The file creator object to register.
   *
   * @returns A disposable which will unregister the creator.
   */
  addCreator(creator: DocumentRegistry.IFileCreator): IDisposable {
    let index = findIndex(this._creators, (value) => {
      return value.name.localeCompare(creator.name) > 0;
    });
    if (index !== -1) {
      this._creators.insert(index, creator);
    } else {
      this._creators.pushBack(creator);
    }
    this.changed.emit({
      type: 'fileCreator',
      name: creator.name,
      change: 'added'
    });
    return new DisposableDelegate(() => {
      this._creators.remove(creator);
      this.changed.emit({
        type: 'fileCreator',
        name: creator.name,
        change: 'removed'
      });
    });
  }

  /**
   * Get a list of the preferred widget factories.
   *
   * @param ext - An optional file extension to filter the results.
   *
   * @returns A new array of widget factories.
   *
   * #### Notes
   * Only the widget factories whose associated model factory have
   * been registered will be returned.
   * The first item is considered the default. The returned iterator
   * has widget factories in the following order:
   * - extension-specific default factory
   * - global default factory
   * - all other extension-specific factories
   * - all other global factories
   */
  preferredWidgetFactories(ext: string = '*'): DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel>[] {
    let factories = new Set<string>();
    ext = Private.normalizeExtension(ext);

    // Start with the extension-specific default factory.
    if (ext.length > 1) {
      if (ext in this._defaultWidgetFactories) {
        factories.add(this._defaultWidgetFactories[ext]);
      }
    }

    // Add the global default factory.
    if (this._defaultWidgetFactory) {
      factories.add(this._defaultWidgetFactory);
    }

    // Add the extension-specific factories in registration order.
    if (ext.length > 1) {
      if (ext in this._widgetFactoryExtensions) {
        each(this._widgetFactoryExtensions[ext], n => {
          factories.add(n);
        });
      }
    }

    // Add the rest of the global factories, in registration order.
    if ('*' in this._widgetFactoryExtensions) {
      each(this._widgetFactoryExtensions['*'], n => {
        factories.add(n);
      });
    }

    // Construct the return list, checking to make sure the corresponding
    // model factories are registered.
    let factoryList: DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel>[] = [];
    factories.forEach(name => {
      if (this._widgetFactories[name].modelName in this._modelFactories) {
        factoryList.push(this._widgetFactories[name]);
      }
    });

    return factoryList;
  }

  /**
   * Get the default widget factory for an extension.
   *
   * @param ext - An optional file extension to filter the results.
   *
   * @returns The default widget factory for an extension.
   *
   * #### Notes
   * This is equivalent to the first value in [[preferredWidgetFactories]].
   */
  defaultWidgetFactory(ext: string = '*'): DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel> {
    return this.preferredWidgetFactories(ext)[0];
  }

  /**
   * Create an iterator over the widget factories that have been registered.
   *
   * @returns A new iterator of widget factories.
   */
  widgetFactories(): IIterator<DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel>> {
    return map(Object.keys(this._widgetFactories), name => {
      return this._widgetFactories[name];
    });
  }

  /**
   * Create an iterator over the model factories that have been registered.
   *
   * @returns A new iterator of model factories.
   */
  modelFactories(): IIterator<DocumentRegistry.IModelFactory<DocumentRegistry.IModel>> {
    return map(Object.keys(this._modelFactories), name => {
      return this._modelFactories[name];
    });
  }

  /**
   * Create an iterator over the registered extensions for a given widget.
   *
   * @param widgetName - The name of the widget factory.
   *
   * @returns A new iterator over the widget extensions.
   */
  widgetExtensions(widgetName: string): IIterator<DocumentRegistry.IWidgetExtension<Widget, DocumentRegistry.IModel>> {
    widgetName = widgetName.toLowerCase();
    if (!(widgetName in this._extenders)) {
      return empty<DocumentRegistry.IWidgetExtension<Widget, DocumentRegistry.IModel>>();
    }
    return this._extenders[widgetName].iter();
  }

  /**
   * Create an iterator over the file types that have been registered.
   *
   * @returns A new iterator of file types.
   */
  fileTypes(): IIterator<DocumentRegistry.IFileType> {
    return this._fileTypes.iter();
  }

  /**
   * Create an iterator over the file creators that have been registered.
   *
   * @returns A new iterator of file creatores.
   */
  creators(): IIterator<DocumentRegistry.IFileCreator> {
    return this._creators.iter();
  }

  /**
   * Get a widget factory by name.
   *
   * @param widgetName - The name of the widget factory.
   *
   * @returns A widget factory instance.
   */
  getWidgetFactory(widgetName: string): DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel> {
    return this._widgetFactories[widgetName.toLowerCase()];
  }

  /**
   * Get a model factory by name.
   *
   * @param name - The name of the model factory.
   *
   * @returns A model factory instance.
   */
  getModelFactory(name: string): DocumentRegistry.IModelFactory<DocumentRegistry.IModel> {
    return this._modelFactories[name.toLowerCase()];
  }

  /**
   * Get a file type by name.
   */
  getFileType(name: string): DocumentRegistry.IFileType {
    name = name.toLowerCase();
    return find(this._fileTypes, fileType => {
      return fileType.name.toLowerCase() === name;
    });
  }

  /**
   * Get a creator by name.
   */
  getCreator(name: string): DocumentRegistry.IFileCreator {
    name = name.toLowerCase();
    return find(this._creators, creator => {
      return creator.name.toLowerCase() === name;
    });
  }

  /**
   * Get a kernel preference.
   *
   * @param ext - The file extension.
   *
   * @param widgetName - The name of the widget factory.
   *
   * @returns A kernel preference.
   */
  getKernelPreference(ext: string, widgetName: string): DocumentRegistry.IKernelPreference {
    ext = Private.normalizeExtension(ext);
    widgetName = widgetName.toLowerCase();
    let widgetFactory = this._widgetFactories[widgetName];
    if (!widgetFactory) {
      return void 0;
    }
    let modelFactory = this.getModelFactory(widgetFactory.modelName);
    if (!modelFactory) {
      return void 0;
    }
    let language = modelFactory.preferredLanguage(ext);
    return {
      language,
      preferKernel: widgetFactory.preferKernel,
      canStartKernel: widgetFactory.canStartKernel
    };
  }

  private _modelFactories: { [key: string]: DocumentRegistry.IModelFactory<DocumentRegistry.IModel> } = Object.create(null);
  private _widgetFactories: { [key: string]: DocumentRegistry.IWidgetFactory<Widget, DocumentRegistry.IModel> } = Object.create(null);
  private _defaultWidgetFactory = '';
  private _defaultWidgetFactories: { [key: string]: string } = Object.create(null);
  private _widgetFactoryExtensions: {[key: string]: Vector<string> } = Object.create(null);
  private _fileTypes = new Vector<DocumentRegistry.IFileType>();
  private _creators = new Vector<DocumentRegistry.IFileCreator>();
  private _extenders: { [key: string] : Vector<DocumentRegistry.IWidgetExtension<Widget, DocumentRegistry.IModel>> } = Object.create(null);
}


/**
 * The namespace for the `DocumentRegistry` class statics.
 */
export
namespace DocumentRegistry {
  /**
   * The interface for a document model.
   */
  export
  interface IModel extends IDisposable {
    /**
     * A signal emitted when the document content changes.
     */
    contentChanged: ISignal<this, void>;

    /**
     * A signal emitted when the model state changes.
     */
    stateChanged: ISignal<this, IChangedArgsGeneric<any>>;

    /**
     * The dirty state of the model.
     *
     * #### Notes
     * This should be cleared when the document is loaded from
     * or saved to disk.
     */
    dirty: boolean;

    /**
     * The read-only state of the model.
     */
    readOnly: boolean;

    /**
     * The default kernel name of the document.
     */
    readonly defaultKernelName: string;

    /**
     * The default kernel language of the document.
     */
    readonly defaultKernelLanguage: string;

    /**
     * Serialize the model to a string.
     */
    toString(): string;

    /**
     * Deserialize the model from a string.
     *
     * #### Notes
     * Should emit a [contentChanged] signal.
     */
    fromString(value: string): void;

    /**
     * Serialize the model to JSON.
     */
    toJSON(): any;

    /**
     * Deserialize the model from JSON.
     *
     * #### Notes
     * Should emit a [contentChanged] signal.
     */
    fromJSON(value: any): void;
  }

  /**
   * The document context object.
   */
  export
  interface IContext<T extends IModel> extends IDisposable {
    /**
     * A signal emitted when the kernel changes.
     */
    kernelChanged: ISignal<this, Kernel.IKernel>;

    /**
     * A signal emitted when the path changes.
     */
    pathChanged: ISignal<this, string>;

    /**
     * A signal emitted when the contentsModel changes.
     */
    fileChanged: ISignal<this, Contents.IModel>;

    /**
     * A signal emitted when the context is disposed.
     */
    disposed: ISignal<this, void>;

    /**
     * Get the model associated with the document.
     */
    readonly model: T;

    /**
     * The current kernel associated with the document.
     */
    readonly kernel: Kernel.IKernel;

    /**
     * The current path associated with the document.
     */
    readonly path: string;

    /**
     * The current contents model associated with the document
     *
     * #### Notes
     * The model will have an empty `contents` field.
     * It will be `null` until the context is ready.
     */
    readonly contentsModel: Contents.IModel;

    /**
     * A promise that is fulfilled when the context is ready.
     */
    ready(): Promise<void>;

    /**
     * Start the default kernel for the context.
     *
     * @returns A promise that resolves with the new kernel.
     */
    startDefaultKernel(): Promise<Kernel.IKernel>;

    /**
     * Change the current kernel associated with the document.
     *
     * #### Notes
     * If no options are given, the session is shut down.
     */
    changeKernel(options?: Kernel.IModel): Promise<Kernel.IKernel>;

    /**
     * Save the document contents to disk.
     */
    save(): Promise<void>;

    /**
     * Save the document to a different path chosen by the user.
     */
    saveAs(): Promise<void>;

    /**
     * Revert the document contents to disk contents.
     */
    revert(): Promise<void>;

    /**
     * Create a checkpoint for the file.
     *
     * @returns A promise which resolves with the new checkpoint model when the
     *   checkpoint is created.
     */
    createCheckpoint(): Promise<Contents.ICheckpointModel>;

    /**
     * Delete a checkpoint for the file.
     *
     * @param checkpointID - The id of the checkpoint to delete.
     *
     * @returns A promise which resolves when the checkpoint is deleted.
     */
    deleteCheckpoint(checkpointID: string): Promise<void>;

    /**
     * Restore the file to a known checkpoint state.
     *
     * @param checkpointID - The optional id of the checkpoint to restore,
     *   defaults to the most recent checkpoint.
     *
     * @returns A promise which resolves when the checkpoint is restored.
     */
    restoreCheckpoint(checkpointID?: string): Promise<void>;

    /**
     * List available checkpoints for the file.
     *
     * @returns A promise which resolves with a list of checkpoint models for
     *    the file.
     */
    listCheckpoints(): Promise<Contents.ICheckpointModel[]>;

    /**
     * Resolve a url to a correct server path.
     */
    resolveUrl(url: string): string;

    /**
     * Add a sibling widget to the document manager.
     *
     * @param widget - The widget to add to the document manager.
     *
     * @returns A disposable used to remove the sibling if desired.
     *
     * #### Notes
     * It is assumed that the widget has the same model and context
     * as the original widget.
     */
    addSibling(widget: Widget): IDisposable;
  }

  /**
   * The options used to initialize a widget factory.
   */
  export
  interface IWidgetFactoryOptions {
    /**
     * The file extensions the widget can view.
     *
     * #### Notes
     * Use "*" to denote all files. Specific file extensions must be preceded
     * with '.', like '.png', '.txt', etc.
     */
    readonly fileExtensions: string[];

    /**
     * The name of the widget to display in dialogs.
     */
    readonly name: string;

    /**
     * The file extensions for which the factory should be the default.
     *
     * #### Notes
     * Use "*" to denote all files. Specific file extensions must be preceded
     * with '.', like '.png', '.txt', etc. Entries in this attribute must also
     * be included in the fileExtensions attribute.
     * The default is an empty array.
     *
     * **See also:** [[fileExtensions]].
     */
    readonly defaultFor?: string[];

    /**
     * The registered name of the model type used to create the widgets.
     */
    readonly modelName?: string;

    /**
     * Whether the widgets prefer having a kernel started.
     */
    readonly preferKernel?: boolean;

    /**
     * Whether the widgets can start a kernel when opened.
     */
    readonly canStartKernel?: boolean;
  }

  /**
   * The interface for a widget factory.
   */
  export
  interface IWidgetFactory<T extends Widget, U extends IModel> extends IDisposable, IWidgetFactoryOptions {
    /**
     * A signal emitted when a widget is created.
     */
    widgetCreated: ISignal<IWidgetFactory<T, U>, T>;

    /**
     * Create a new widget given a context.
     *
     * #### Notes
     * It should emit the [widgetCreated] signal with the new widget.
     */
    createNew(context: IContext<U>): T;
  }

  /**
   * An interface for a widget extension.
   */
  export
  interface IWidgetExtension<T extends Widget, U extends IModel> {
    /**
     * Create a new extension for a given widget.
     */
    createNew(widget: T, context: IContext<U>): IDisposable;
  }


  /**
   * The interface for a model factory.
   */
  export
  interface IModelFactory<T extends IModel> extends IDisposable {
    /**
     * The name of the model.
     */
    readonly name: string;

    /**
     * The content type of the file (defaults to `"file"`).
     */
    readonly contentType: Contents.ContentType;

    /**
     * The format of the file (defaults to `"text"`).
     */
    readonly fileFormat: Contents.FileFormat;

    /**
     * Create a new model for a given path.
     *
     * @param languagePreference - An optional kernel language preference.
     *
     * @returns A new document model.
     */
    createNew(languagePreference?: string): T;

    /**
     * Get the preferred kernel language given an extension.
     */
    preferredLanguage(ext: string): string;
  }

  /**
   * A kernel preference for a given file path and widget.
   */
  export
  interface IKernelPreference {
    /**
     * The preferred kernel language.
     */
    readonly language: string;

    /**
     * Whether to prefer having a kernel started when opening.
     */
    readonly preferKernel: boolean;

    /**
     * Whether a kernel when can be started when opening.
     */
    readonly canStartKernel: boolean;
  }

  /**
   * An interface for a file type.
   */
  export
  interface IFileType {
    /**
     * The name of the file type.
     */
    readonly name: string;

    /**
     * The extension of the file type (e.g. `".txt"`).
     */
    readonly extension: string;

    /**
     * The optional mimetype of the file type.
     */
    readonly mimetype?: string;

    /**
     * The optional icon class to use for the file type.
     */
    readonly icon?: string;

    /**
     * The content type of the new file (defaults to `"file"`).
     */
    readonly contentType?: Contents.ContentType;

    /**
     * The format of the new file (default to `"text"`).
     */
    readonly fileFormat?: Contents.FileFormat;
  }

  /**
   * An interface for a "Create New" item.
   */
  export
  interface IFileCreator {
    /**
     * The name of the file creator.
     */
    readonly name: string;

    /**
     * The filetype name associated with the creator.
     */
    readonly fileType: string;

    /**
     * The optional widget name.
     */
    readonly widgetName?: string;

    /**
     * The optional kernel name.
     */
    readonly kernelName?: string;
  }

  /**
   * An arguments object for the `changed` signal.
   */
  export
  interface IChangedArgs {
    /**
     * The type of the changed item.
     */
    readonly type: 'widgetFactory' | 'modelFactory' | 'widgetExtension' | 'fileCreator' | 'fileType';

    /**
     * The name of the item.
     */
    readonly name: string;

    /**
     * Whether the item was added or removed.
     */
    readonly change: 'added' | 'removed';
  }
}


// Define the signals for the `DocumentRegistry` class.
defineSignal(DocumentRegistry.prototype, 'changed');


/**
 * A private namespace for DocumentRegistry data.
 */
namespace Private {
  /**
   * Normalize a file extension to be of the type `'.foo'`.
   *
   * Adds a leading dot if not present and converts to lower case.
   */
  export
  function normalizeExtension(extension: string): string {
    if (extension === '*') {
      return extension;
    }
    if (extension === '.*') {
      return '*';
    }
    if (extension.indexOf('.') !== 0) {
      extension = `.${extension}`;
    }
    return extension.toLowerCase();
  }
}

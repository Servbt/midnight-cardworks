export type UploadImageInput = {
  fileName: string;
  contentType: string;
  dataUrl: string;
  folder?: string;
};

export type UploadImageResult = { url: string };
export type UploadImage = (input: UploadImageInput) => Promise<UploadImageResult>;

function isConfigured(value: string | undefined) {
  return Boolean(value && !value.includes('replace_me') && !value.includes('placeholder'));
}

export const uploadProductImage: UploadImage = async (input) => {
  if (!input.contentType.startsWith('image/')) throw new Error('Only image uploads are supported');

  if (isConfigured(process.env.CLOUDINARY_URL)) {
    const { v2: cloudinary } = await import('cloudinary');
    const upload = await cloudinary.uploader.upload(input.dataUrl, {
      folder: input.folder ?? 'midnight-cardworks/products',
      resource_type: 'image',
      use_filename: true,
      unique_filename: true,
      filename_override: input.fileName
    });
    return { url: upload.secure_url };
  }

  return { url: input.dataUrl };
};
